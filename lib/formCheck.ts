import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { aiOn, claude, jsonFrom, writerModel } from "./ai";
import { aiSettings } from "./aiSettings";
import { auditSystem } from "./audit";
import { logDecision, isSpotCheck } from "./aiTrust";
import type { Change } from "./aiChange";
import { dealKey } from "./chatTypes";
import { Answers, Field, HANDOVER_AFTER, HANDOVER_ROUTE, HANDOVER_SIMPLE, INTAKE_SECTIONS, Kind, WEEKLY_SECTIONS, arr, healthFlags, items, kindName, s } from "./reports";
import type { Booking } from "./types";

// The form checker (migration 055). When a trainer submits a form, Claude reads it against that form's checklist (and the
// dog's chat) and says "fits the standard" or what to check, in up to 3 points that quote the form. The admin still
// approves or sends back, and what they did is recorded beside the verdict, so Pulse → Office shows how often it's right.
// Switch (Pulse → Office): Off · Suggest · Approve clean ones itself. "Itself" is only ever weekly checks and intake forms
// (they stay internal) with nothing to look at; handover reports go to the client, so a person always approves those.

export type CheckPoint = { point: string; quote?: string };
export type FormCheck = { id: string; verdict: "ok" | "check"; points: CheckPoint[]; created_at: string; outcome: string | null };
type Report = { id: string; booking_id: string; trainer_id: string; kind: Kind; week_number: number; status: string; answers: Answers; submitted_at: string | null };

const clip = (v: unknown, n: number) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The form as the admin reads it: "Question: answer", one per line. */
export function formText(kind: Kind, a: Answers): string {
  const line = (f: Field): string => {
    if (f.type === "yesno") return `${f.label}: ${a[f.key] === "yes" ? "Yes" : a[f.key] === "no" ? "No" : "(not answered)"}${s(a[`${f.key}_detail`]) ? `. ${s(a[`${f.key}_detail`])}` : ""}`;
    if (f.type === "multi") return `${f.label}: ${[...arr(a[f.key]), s(a[`${f.key}_other`])].filter(Boolean).join(", ") || "(not answered)"}`;
    if (f.type === "confirm") return `${f.label}: ${a[f.key] === true ? "Confirmed" : "(not confirmed)"}`;
    return `${f.label}: ${s(String(a[f.key] ?? "")) || "(empty)"}`;
  };
  if (kind === "weekly") return WEEKLY_SECTIONS.flatMap((x) => x.fields).map(line).join("\n");
  if (kind === "intake") return INTAKE_SECTIONS.flatMap((x) => x.fields).map(line).join("\n");
  const list = (name: string, v: unknown) => items(v).filter((i) => i.title || i.text).map((i, n) => `${name} ${n + 1}: ${i.title || "(no name)"}. ${i.text || "(empty)"}`);
  return [...HANDOVER_SIMPLE.map(line), ...list("Training item", a.training), ...list("Homework item", a.homework), ...HANDOVER_AFTER.map(line), ...HANDOVER_ROUTE.map(line)].join("\n");
}

/** The dog's chat around the form: the week before a weekly check, the pickup days for an intake form, the last stretch for a handover. */
async function chatText(sb: SupabaseClient, b: Booking, r: Report): Promise<string> {
  const { data: chat } = await sb.from("chats").select("id").eq("deal_key", dealKey(b)).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!chat) return "";
  const end = r.submitted_at || new Date().toISOString();
  const from = r.kind === "weekly" ? new Date(Date.parse(end) - 9 * 864e5).toISOString() : r.kind === "intake" ? `${b.start_date}T00:00:00Z` : `${b.start_date}T00:00:00Z`;
  const { data } = await sb.from("chat_messages").select("created_at, sender_role, sender_id, body, kind").eq("chat_id", chat.id).gte("created_at", from).lte("created_at", end).in("sender_role", ["trainer", "client", "admin"]).order("created_at", { ascending: false }).limit(r.kind === "handover" ? 80 : 50);
  const rows = ((data || []) as { created_at: string; sender_role: string; sender_id: string | null; body: string | null; kind: string }[]).filter((m) => m.sender_role !== "admin" || m.sender_id).reverse();
  return rows.map((m) => `${m.created_at.slice(5, 10)} ${m.sender_role === "trainer" ? "Trainer" : m.sender_role === "client" ? "Client" : "Office"}: ${m.body ? clip(m.body, 400) : "(a photo or video)"}`).join("\n").slice(-7000);
}

const SYSTEM = `You check forms that dog trainers send to the office of Dogwise Academy (a dog board-and-train business), so an admin can approve them faster. You are given the kind of form, the office's checklist for it, the form as submitted, and recent messages from the dog's chat.

Decide:
- "ok": the form meets the checklist. An admin would approve it as it is.
- "check": an admin should look at something before approving. Give at most 3 points, the most important first. Each point is one short plain sentence saying what to check and why, and quotes the words from the form (or the chat) it is about.

Be strict about health and about anything that contradicts the chat. Do not nitpick style, spelling or length when the meaning is clear. Do not invent problems: if you are not sure something is wrong, it is "ok".

Answer with JSON only: {"verdict":"ok"|"check","points":[{"point":"...","quote":"..."}]}`;

/** The latest check of this report since it was (last) submitted, or null. */
export async function latestCheck(sb: SupabaseClient, reportId: string, submittedAt: string | null): Promise<FormCheck | null> {
  let q = sb.from("ai_form_checks").select("id, verdict, points, created_at, outcome").eq("report_id", reportId).order("created_at", { ascending: false }).limit(1);
  if (submittedAt) q = q.gte("created_at", submittedAt);
  const { data, error } = await q;
  return error || !data?.length ? null : (data[0] as FormCheck);
}

/** Checks one submitted form (once per submission). In "auto" mode a clean weekly check or intake form is approved here. Never throws. */
export async function checkForm(reportId: string, sb: SupabaseClient = serviceClient()): Promise<FormCheck | null> {
  try {
    if (!aiOn()) return null;
    const cfg = await aiSettings(sb);
    if (cfg.formCheck === "off") return null;
    const { data: r } = await sb.from("reports").select("id, booking_id, trainer_id, kind, week_number, status, answers, submitted_at").eq("id", reportId).maybeSingle();
    const rep = r as Report | null;
    if (!rep || rep.status !== "submitted") return null;
    const had = await latestCheck(sb, rep.id, rep.submitted_at);
    if (had) return had;
    const { data: b } = await sb.from("bookings").select("*").eq("id", rep.booking_id).maybeSingle();
    if (!b) return null;
    const a = rep.answers || {}, chat = await chatText(sb, b as Booking, rep);
    const out = jsonFrom<{ verdict?: string; points?: { point?: string; quote?: string }[] }>(await claude({
      system: SYSTEM, maxTokens: 500, timeoutMs: 15000,
      user: `Form: ${kindName(rep.kind)}${rep.kind === "weekly" ? ` (week ${rep.week_number})` : ""} for ${s(a.dogName) || b.dog_name || "the dog"}, program ${b.start_date} to ${b.end_date}.\n\nThe office's checklist:\n${cfg.checklists[rep.kind]}\n\nThe form as submitted:\n${formText(rep.kind, a)}\n\nThe dog's chat (${chat ? "oldest first" : "no messages"}):\n${chat || "(nothing)"}`
    }));
    if (!out || (out.verdict !== "ok" && out.verdict !== "check")) return null;
    const points = (out.points || []).filter((p) => p && s(p.point)).slice(0, 3).map((p) => ({ point: clip(p.point, 260), quote: s(p.quote) ? clip(p.quote, 200) : undefined }));
    const verdict = out.verdict === "check" && points.length ? "check" : "ok";
    const { data: row, error } = await sb.from("ai_form_checks").insert({ report_id: rep.id, kind: rep.kind, trainer_id: rep.trainer_id, verdict, points: verdict === "ok" ? [] : points, model: writerModel() }).select("id, verdict, points, created_at, outcome").single();
    if (error || !row) return null;
    // Approve it itself? Only what stays internal, only when there is nothing at all to look at
    if (cfg.formCheck === "auto" && verdict === "ok" && rep.kind !== "handover" && !healthFlags(rep.kind, a).length && !isSpotCheck(rep.id)) {
      const { data: inc } = await sb.from("chat_incidents").select("id").eq("report_id", rep.id).neq("status", "resolved").limit(1);
      if (!inc?.length) {
        const now = new Date().toISOString();
        const { error: e } = await sb.from("reports").update({ status: "approved", approved_by_name: "Checked automatically", approved_at: now, review_note: null }).eq("id", rep.id).eq("status", "submitted");
        if (!e) {
          await sb.from("ai_form_checks").update({ outcome: "auto", outcome_by: "app", outcome_at: now, edited: false }).eq("id", row.id);
          await logDecision({ feature: "forms", itemId: rep.id, label: `${s(a.dogName) || b.dog_name || "Dog"}: ${kindName(rep.kind)}`, ai: "ok", decision: "approved", agreed: null, by: "app", auto: true }, sb);
          await auditSystem("Form checked and approved automatically", `${kindName(rep.kind)}${rep.kind === "weekly" ? ` (week ${rep.week_number})` : ""} for ${s(a.dogName) || b.dog_name || "the dog"}: fits the standard, nothing to look at.`, { link: `/a/reports/${rep.id}` }).catch(() => null);
          return { ...(row as FormCheck), outcome: "auto" };
        }
      }
    }
    return row as FormCheck;
  } catch { return null; }
}

/** The 20-minute forms job: checks forms submitted in the last 14 days that haven't been checked since they came in. */
export async function runFormChecks(sb: SupabaseClient = serviceClient(), limit = 8, until = Infinity) {
  const out = { checked: 0, auto: 0 };
  if (!aiOn()) return out;
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data, error } = await sb.from("reports").select("id, submitted_at").eq("status", "submitted").gte("submitted_at", since).order("submitted_at").limit(60);
  if (error || !data?.length) return out;
  const reps = data as { id: string; submitted_at: string }[];
  const { data: done, error: e } = await sb.from("ai_form_checks").select("report_id, created_at").in("report_id", reps.map((r) => r.id));
  if (e) return out; // migration 055 not run yet
  const todo = reps.filter((r) => !((done || []) as { report_id: string; created_at: string }[]).some((c) => c.report_id === r.id && c.created_at >= r.submitted_at)).slice(0, limit);
  for (const r of todo) { if (Date.now() > until) break; const c = await checkForm(r.id, sb); if (c) { out.checked++; if (c.outcome === "auto") out.auto++; } }
  return out;
}

/** What the admin did with a checked form, recorded on its latest check that has no outcome yet, and logged for the approval
 *  rate. `change`: how much they changed first (a typo or a word is "minor" and counts as agreeing, lib/aiChange.ts). */
export async function noteCheckOutcome(reportId: string, outcome: "approved" | "sent_back", by: string, change: Change, label?: string, sb: SupabaseClient = serviceClient()) {
  try {
    const { data } = await sb.from("ai_form_checks").select("id, verdict, created_at").eq("report_id", reportId).is("outcome", null).order("created_at", { ascending: false }).limit(1);
    const c = (data || [])[0] as { id: string; verdict: "ok" | "check"; created_at: string } | undefined;
    if (!c) return;
    await sb.from("ai_form_checks").update({ outcome, outcome_by: by, outcome_at: new Date().toISOString(), edited: change === "major", change }).eq("id", c.id);
    // Agreed: it said "fits" and it was approved without a real correction, or it said "check" and the admin sent it back or corrected it
    const agreed = c.verdict === "ok" ? outcome === "approved" && change !== "major" : outcome === "sent_back" || change === "major";
    const { data: spot } = await sb.from("app_settings").select("value").eq("key", "ai.formCheck").maybeSingle();
    await logDecision({ feature: "forms", itemId: reportId, label, ai: c.verdict, decision: outcome, agreed, change, by, spot: spot?.value === "auto" }, sb);
  } catch { /* the record never gets in the way of the review */ }
}

/** For Pulse → Office: how the checks did over the range. */
export async function formCheckStats(sb: SupabaseClient, sinceIso: string) {
  const { data, error } = await sb.from("ai_form_checks").select("verdict, outcome, edited").gte("created_at", sinceIso).limit(5000);
  if (error) return null;
  const rows = (data || []) as { verdict: string; outcome: string | null; edited: boolean | null }[];
  const n = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const decided = rows.filter((r) => r.outcome === "approved" || r.outcome === "sent_back");
  const agreed = decided.filter((r) => (r.verdict === "ok" && r.outcome === "approved" && !r.edited) || (r.verdict === "check" && (r.outcome === "sent_back" || r.edited))).length;
  return {
    checked: rows.length, fits: n((r) => r.verdict === "ok"), toCheck: n((r) => r.verdict === "check"), auto: n((r) => r.outcome === "auto"),
    decided: decided.length, agreed, agreedPct: decided.length ? Math.round((agreed / decided.length) * 100) : null,
    fitsButSentBack: n((r) => r.verdict === "ok" && (r.outcome === "sent_back" || (r.outcome === "approved" && !!r.edited))),
    flaggedButFine: n((r) => r.verdict === "check" && r.outcome === "approved" && !r.edited)
  };
}
