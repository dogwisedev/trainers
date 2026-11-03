import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { hubspotConfigured, optionValue, propDefs, readDealHistory, readDeals, updateDeal, type PropDef } from "./hubspot";
import { droppedOff, pickedUp } from "./moveRules";
import { addDays, todayIso } from "./dates";
import { beforeApp, endOfDay, handoverWindow, lateDays, weeklyWindows } from "./reports";
import { auditSystem } from "./audit";

// The program's progress, from the app to its HubSpot deal (runs with the 30-minute HubSpot sync), so the office never
// types it by hand: Pick Up Confirmation, Trainer Intake Form, Weekly Report #1–6 received (Yes / Sent w/ delay / No /
// N/A), Handover received + date, Drop Off Confirmation, Start Follow Up Management, Ongoing, Needs Attention Status,
// Client Status (forward only), Point of Contact.
// Rules: only write a field when its value changes; never downgrade something already recorded (a Yes stays a Yes);
// forms due before the Oct 23 cutover are left as they are (done the old way); Cancelled, Refunded and "Monitoring"
// are never overwritten (people set those).

const WEEKLY = [1, 2, 3, 4, 5, 6].map((n) => (n === 1 ? "has_weekly_report__1_been_received_" : `has_weekly_report__${n}_been_received_`));
const FIELDS = ["pick_up_confirmation", "trainer_intake_form", ...WEEKLY, "has_handover_report_been_received_", "handover_reports", "drop_off_confirmation",
  "start_follow_up_management", "ongoing", "needs_attention_status", "client_status", "point_of_contact",
  "items", "group_created", "is_client_in_the_group_", "signal_group_link", "enrol_in_after_sale_follow_up"];
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://trainers-seven.vercel.app").replace(/\/$/, "");
const STATUS_ORDER = ["Not started", "Ongoing", "Completed with Handover Report", "Completed with Follow up"];
const NEVER_TOUCH = /^(cancelled|refunded|after graduation support)$/i;

type B = { id: string; trainer_id: string; hubspot_deal_id: string; start_date: string; end_date: string; weeks: number | null; status: string; reports_enabled: boolean | null; picked_up_at?: string | null; dropped_off_at?: string | null };
/** HubSpot date fields come back as "2026-10-31" (or a timestamp); the app writes midnight-UTC milliseconds. Compare as a day. */
const asDay = (v: unknown) => { const s = String(v ?? "").trim(); if (!s) return ""; if (/^\d{10,}$/.test(s)) return new Date(Number(s)).toISOString().slice(0, 10); return s.slice(0, 10); };
/** The app's own writes since the progress sync started: only these are ever undone. */
const APP_SINCE = "2026-11-02T00:00:00Z";
type R = { booking_id: string; kind: string; week_number: number; status: string; submitted_at: string | null; due_by: string | null; items?: string | null };
type Received = "Yes" | "Sent w/ delay" | "No" | "N/A" | null; // null = not due yet, or nothing to say

/** One form for one booking: received on time, late, missing past its deadline, not needed, or not due yet. */
function received(b: B, reps: R[], kind: string, week: number, deadline: string, now: Date): Received {
  const r = reps.find((x) => x.booking_id === b.id && x.kind === kind && x.week_number === week);
  if (r?.status === "waived") return "N/A";
  if (r && (r.status === "submitted" || r.status === "approved" || r.status === "changes_requested") && r.submitted_at) return lateDays(r.submitted_at, r.due_by || endOfDay(deadline).toISOString()) > 0 ? "Sent w/ delay" : "Yes";
  return now > endOfDay(deadline) ? "No" : null;
}
/** Several dogs on one deal: all in on time = Yes; all in, some late = Sent w/ delay; any missing past its deadline = No. */
function combine(xs: Received[]): Received {
  if (!xs.length || xs.some((x) => x === null)) return xs.includes("No") ? "No" : null;
  if (xs.includes("No")) return "No";
  if (xs.every((x) => x === "N/A")) return "N/A";
  return xs.includes("Sent w/ delay") ? "Sent w/ delay" : "Yes";
}
const isDone = (v: string | null | undefined) => /^(yes|true|sent w\/ delay|n\/a)$/i.test(String(v || "").trim());

export async function syncProgramStatus(sb: SupabaseClient = serviceClient(), now = new Date(), only?: string[]) {
  const out = { deals: 0, written: 0, reverted: 0, fields: {} as Record<string, number>, errors: [] as string[] };
  if (!hubspotConfigured()) return out;
  const today = todayIso();
  let bq = sb.from("bookings").select("*").neq("status", "cancelled").not("hubspot_deal_id", "is", null).lte("start_date", addDays(today, 60)).gte("end_date", addDays(today, -30));
  if (only?.length) bq = bq.in("hubspot_deal_id", only);
  const { data: bks, error } = await bq.limit(400);
  if (error) { out.errors.push(error.message); return out; }
  const bookings = ((bks || []) as B[]).filter((b) => /^\d+$/.test(b.hubspot_deal_id));
  if (!bookings.length) return out;
  const ids = bookings.map((b) => b.id), dealIds = [...new Set(bookings.map((b) => b.hubspot_deal_id))];
  const [{ data: reps }, { data: incs }, { data: chats }, { data: trs }, current, defs] = await Promise.all([
    sb.from("reports").select("booking_id, kind, week_number, status, submitted_at, due_by, items:answers->>items").in("booking_id", ids),
    sb.from("chat_incidents").select("kind, booking_id, chat_id").neq("status", "resolved"),
    sb.from("chats").select("id, deal_key, client_user_id, status").in("deal_key", dealIds),
    sb.from("trainers").select("id, poc"),
    readDeals(dealIds, FIELDS),
    propDefs("deals")
  ]);
  const reports = (reps || []) as R[], open = (incs || []) as { kind: string; booking_id: string | null; chat_id: string | null }[];
  const has = (b: B, kind: string) => reports.some((r) => r.booking_id === b.id && r.kind === kind && !!r.submitted_at);
  const picked = (g: B[]) => g.every((b) => pickedUp(b, has(b, "intake"))), dropped = (g: B[]) => g.every((b) => droppedOff(b, has(b, "handover")));
  // Deals the app may have moved too early (by date): read their history once, to undo only the app's own changes
  const suspects = dealIds.filter((id) => { const g = bookings.filter((b) => b.hubspot_deal_id === id), c = current.get(id) || {}; return !picked(g) && (/^ongoing$/i.test(String(c.client_status || "").trim()) || !!c.ongoing); });
  const history = suspects.length ? await readDealHistory(suspects, ["client_status", "ongoing"]).catch(() => new Map()) : new Map();
  const appWrote = (h: { value: string; timestamp: string; sourceType?: string }[] | undefined) => !!h?.length && h[0].sourceType === "INTEGRATION" && h[0].timestamp >= APP_SINCE;
  const chatRows = (chats || []) as { id: string; deal_key: string; client_user_id: string | null; status: string }[];
  const chatOfDeal = new Map(chatRows.map((c) => [c.deal_key, c.id]));
  // Has the client opened their chat? (the app's "group")
  const { data: reads } = chatRows.length ? await sb.from("chat_reads").select("chat_id, user_id").in("chat_id", chatRows.map((c) => c.id)) : { data: [] };
  const opened = new Set(((reads || []) as { chat_id: string; user_id: string }[]).filter((r) => chatRows.some((c) => c.id === r.chat_id && c.client_user_id === r.user_id)).map((r) => r.chat_id));
  const pocOf = new Map(((trs || []) as { id: string; poc: string | null }[]).map((t) => [t.id, String(t.poc || "").trim()]));

  for (const dealId of dealIds) {
    out.deals++;
    const group = bookings.filter((b) => b.hubspot_deal_id === dealId), cur = current.get(dealId) || {};
    if (NEVER_TOUCH.test(String(cur.client_status || "").trim())) continue; // Cancelled / Refunded / After Graduation Support: people own this deal now
    const start = group.map((b) => b.start_date).sort()[0], end = group.map((b) => b.end_date).sort().pop()!;
    const want: Record<string, string> = {};
    const put = (name: string, label: string) => { const d: PropDef | undefined = defs.get(name); if (!d) return; const v = d.type === "date" ? label : optionValue(d, label); if (v != null) want[name] = v; };
    const forms = group.filter((b) => b.reports_enabled !== false);

    // Pickup: confirmed by the trainer, or the intake form; the intake form on its own field
    const isPicked = picked(group), isDropped = dropped(group);
    if (isPicked) put("pick_up_confirmation", "Yes");
    if (forms.length && forms.every((b) => has(b, "intake"))) put("trainer_intake_form", "Yes");
    // Weekly reports 1–6
    WEEKLY.forEach((field, i) => {
      const n = i + 1;
      const per = forms.map((b) => { const w = weeklyWindows(b.start_date, b.end_date); if (n > w.length) return "N/A" as Received; if (beforeApp(w[n - 1])) return null; return received(b, reports, "weekly", n, w[n - 1].deadline, now); });
      if (!forms.length) return;
      const v = combine(per);
      if (!v) return;
      if (v === "No" && isDone(cur[field])) return;            // never downgrade a recorded report
      if (v === "N/A" && cur[field]) return;                    // N/A only fills an empty box
      put(field, v);
    });
    // Handover, drop-off, follow-up management
    if (forms.length) {
      const hw = handoverWindow(end);
      if (!beforeApp(hw)) {
        const v = combine(forms.map((b) => received(b, reports, "handover", 0, handoverWindow(b.end_date).deadline, now)));
        if (v && !(v === "No" && isDone(cur.has_handover_report_been_received_)) && v !== "N/A") put("has_handover_report_been_received_", v);
        if (v === "Yes" || v === "Sent w/ delay") {
          const at = forms.map((b) => reports.find((r) => r.booking_id === b.id && r.kind === "handover")?.submitted_at || "").sort().pop() || "";
          if (at && defs.get("handover_reports")?.type === "date") { const d = at.slice(0, 10); want.handover_reports = String(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))); }
          if (!cur.start_follow_up_management) put("start_follow_up_management", "Yes");
        }
      }
    }
    if (isDropped) put("drop_off_confirmation", "Yes");
    // The app chat stands in for the Signal group: Group Created, Is Client in the group?, and the chat's link in "Signal Group link"
    const chat = chatRows.find((c) => c.deal_key === dealId);
    if (chat) {
      put("group_created", "Yes");
      if (!/doesn.?t have the app/i.test(String(cur.is_client_in_the_group_ || ""))) put("is_client_in_the_group_", opened.has(chat.id) ? "Yes" : "No");
      if (defs.has("signal_group_link")) want.signal_group_link = `${site()}/a/chats/${chat.id}`;
    }
    // Items: what came with the dog, from the trainer's intake form (two dogs: "Rex: …; Bella: …")
    const itemLines = forms.map((b) => ({ dog: (b as { dog_name?: string | null }).dog_name || "Dog", v: String(reports.find((r) => r.booking_id === b.id && r.kind === "intake" && r.submitted_at)?.items || "").trim() })).filter((x) => x.v);
    if (itemLines.length && defs.has("items")) want.items = (itemLines.length > 1 ? itemLines.map((x) => `${x.dog}: ${x.v}`).join(" | ") : itemLines[0].v).slice(0, 2000);
    // After-sale follow-up starts once the handover is in (never over a Stop someone set)
    if (want.start_follow_up_management || /^(yes|true)$/i.test(String(cur.start_follow_up_management || ""))) { if (!/^stop$/i.test(String(cur.enrol_in_after_sale_follow_up || "").trim()) && /^(yes|sent w\/ delay)$/i.test(String(defs.get("has_handover_report_been_received_")?.options.find((o) => o.value === (want.has_handover_report_been_received_ ?? cur.has_handover_report_been_received_))?.label || cur.has_handover_report_been_received_ || ""))) put("enrol_in_after_sale_follow_up", "Start"); }
    // In care (picked up, not yet home): Ongoing (All good / Warning / Needs attention) and Needs Attention Status
    if (isPicked && !isDropped) {
      const chatId = chatOfDeal.get(dealId), mine = open.filter((i) => group.some((b) => b.id === i.booking_id) || (chatId && i.chat_id === chatId));
      const needs = mine.some((i) => ["client_waiting", "client_pileup", "trainer_report"].includes(i.kind));
      const lateForm = forms.some((b) => weeklyWindows(b.start_date, b.end_date).some((w) => !beforeApp(w) && received(b, reports, "weekly", w.week, w.deadline, now) === "No"));
      const warn = mine.some((i) => i.kind === "trainer_silent") || lateForm;
      put("ongoing", needs ? "Needs attention" : warn ? "Warning" : "All good");
      if (!/^monitoring$/i.test(String(cur.needs_attention_status || "").trim())) {
        const waitingOnClient = mine.some((i) => i.kind === "not_ready");
        if (needs) put("needs_attention_status", "Waiting on Us");
        else if (waitingOnClient) put("needs_attention_status", "Waiting on Client");
        else if (/^waiting on (us|client)$/i.test(String(cur.needs_attention_status || "").trim())) put("needs_attention_status", "Solved");
      }
    }
    // Client Status follows the confirmations, never the dates: Not started → Ongoing (picked up) → Completed with Handover
    // Report (home and the handover in). Forward only, back from Standby once booked again, and back to what it was before
    // when the app itself moved it too early (HubSpot's history says the last change was the app's).
    const cs = String(cur.client_status || "").trim();
    if (!NEVER_TOUCH.test(cs)) {
      const handed = /^(yes|sent w\/ delay)$/i.test(String(want.has_handover_report_been_received_ ? defs.get("has_handover_report_been_received_")?.options.find((o) => o.value === want.has_handover_report_been_received_)?.label || "" : cur.has_handover_report_been_received_ || "").trim());
      const target = !isPicked ? "Not started" : !isDropped ? "Ongoing" : handed ? "Completed with Handover Report" : "Ongoing";
      const ci = STATUS_ORDER.findIndex((x) => x.toLowerCase() === cs.toLowerCase()), ti = STATUS_ORDER.indexOf(target);
      if (!cs || /^standby$/i.test(cs) || (ci >= 0 && ti > ci)) put("client_status", target);
      else if (ti < ci && target === "Not started") {
        const h = history.get(dealId)?.client_status;
        if (appWrote(h)) { const before = String(h![1]?.value || "Not started"); const v = optionValue(defs.get("client_status"), before) ?? ""; want.client_status = v; out.reverted++; }
      }
    }
    // The health field ("Ongoing": All good / Warning) only means anything while the dog is in care
    if (!isPicked && cur.ongoing) { const h = history.get(dealId)?.ongoing; if (appWrote(h)) { want.ongoing = String(h![1]?.value || ""); out.reverted++; } }
    // Point of Contact: the trainer's POC, when it matches one of HubSpot's names and the deal has none yet
    if (!cur.point_of_contact) {
      const poc = pocOf.get(group[0].trainer_id) || "", def = defs.get("point_of_contact");
      const o = poc && def?.options.find((x) => { const l = x.label.trim().toLowerCase(), p = poc.toLowerCase(); return l === p || l.split(" ")[0] === p.split(" ")[0]; });
      if (o) want.point_of_contact = o.value;
    }

    const props = Object.fromEntries(Object.entries(want).filter(([k, v]) => (defs.get(k)?.type === "date" ? asDay(cur[k]) !== asDay(v) : String(cur[k] ?? "") !== v)));
    if (!Object.keys(props).length) continue;
    try { await updateDeal(dealId, props); out.written++; for (const k of Object.keys(props)) out.fields[k] = (out.fields[k] || 0) + 1; }
    catch (e) { out.errors.push(`${dealId}: ${(e as Error).message}`); }
  }
  if (out.written) await auditSystem("Updated program progress in HubSpot", `${out.written} deal${out.written > 1 ? "s" : ""}: ${Object.entries(out.fields).map(([k, n]) => `${k} ×${n}`).join(", ")}.${out.reverted ? ` Undid ${out.reverted} change${out.reverted > 1 ? "s" : ""} the app had made too early.` : ""}`, { link: "/a/dogs" });
  return out;
}
