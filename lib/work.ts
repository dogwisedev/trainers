import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { auditSystem } from "./audit";
import { addDays, todayIso } from "./dates";
import { hubspotConfigured, listOwners, readDealHistory } from "./hubspot";

// Where the work goes (migration 059): what people still do by hand, how often, how long it takes, and why they
// overrode the app. For learning what to automate next; read on Pulse → Where the work goes.

/** The one-tap reasons offered when a person overrides the app. Short, in their words. */
export const REASONS: Record<string, string[]> = {
  "form:waive": ["Dog went home early", "Program changed", "Shouldn't exist", "Other"],
  "form:missed": ["Next form already in", "Too late to be useful", "Trainer did it another way", "Other"],
  "todo:done": ["Done in HubSpot", "Done by phone", "Done by email or text", "Not needed", "Other"],
  "client:noreply": ["Just thanks or OK", "Answered by phone", "Answered by email or text", "Not a question", "Other"],
  "client:handled": ["Answered by phone", "Answered by email or text", "Sean decided", "Not needed", "Other"],
  "booking:force": ["Trainer agreed to a bonus dog", "Kennel count is wrong", "Short program", "Other"],
  "booking:yes": ["Spoke to them by phone", "They said yes on Slack", "Agreed in person", "Other"]
};

/** Keeps a person's reason. Never throws. */
export async function logReason(d: { action: keyof typeof REASONS | string; item?: string | null; label?: string | null; who: string; reason: string }, sb: SupabaseClient = serviceClient()) {
  try { if (d.reason.trim()) await sb.from("work_reasons").insert({ action: d.action, item: d.item || null, label: d.label || null, who: d.who, reason: d.reason.trim().slice(0, 120) }); } catch { /* never in the way */ }
}

// ── Work still done in HubSpot by hand ──
const WATCH = ["program_start_date", "training_end_date", "program_end_date", "client_status", "trainer", "point_of_contact", "amount_paid", "amount_outstanding", "remaining_balance_link", "dealstage", "hubspot_owner_id",
  "follow_up_session__1", "follow_up_session__2", "follow_up_session__3", "pick_up_confirmation", "drop_off_confirmation", "vaccines", "closedate"];
const HUMAN = (src?: string) => !!src && (/^CRM_UI/i.test(src) || /^MOBILE/i.test(src) || /^IMPORT/i.test(src) || /^BULK/i.test(src));

/** Once a day: deal properties changed by a person in HubSpot (not the app, not a workflow) on live and recent deals. Never throws. */
export async function pullHubspotWork(sb: SupabaseClient = serviceClient()) {
  const out = { deals: 0, changes: 0, errors: [] as string[] };
  try {
    if (!hubspotConfigured()) return out;
    const { data: last } = await sb.from("app_settings").select("value").eq("key", "work.hubspotPulledAt").maybeSingle();
    const since = typeof last?.value === "string" ? last.value : new Date(Date.now() - 14 * 864e5).toISOString();
    if (Date.now() - Date.parse(since) < 20 * 3600e3) return out; // once a day is enough
    const today = todayIso();
    const { data: bks } = await sb.from("bookings").select("hubspot_deal_id, dog_name, client_name").not("hubspot_deal_id", "is", null).neq("status", "cancelled").gte("end_date", addDays(today, -30)).lte("start_date", addDays(today, 60)).limit(400);
    const deals = ((bks || []) as { hubspot_deal_id: string; dog_name: string | null; client_name: string }[]).filter((b) => /^\d+$/.test(b.hubspot_deal_id));
    if (!deals.length) return out;
    const names = new Map<string, string>();
    try { for (const o of await listOwners()) { names.set(o.id, o.name); if (o.email) names.set(o.email, o.name); } } catch { /* ids will do */ }
    const hist = await readDealHistory(deals.map((d) => d.hubspot_deal_id), WATCH);
    const rows: Record<string, unknown>[] = [];
    for (const d of deals) {
      const h = hist.get(d.hubspot_deal_id); if (!h) continue;
      out.deals++;
      for (const [prop, changes] of Object.entries(h)) for (const c of changes || []) {
        if (c.timestamp <= since || !HUMAN(c.sourceType)) continue;
        const by = c.updatedByUserId != null ? names.get(String(c.updatedByUserId)) || `user ${c.updatedByUserId}` : c.sourceLabel || c.sourceId || "someone";
        rows.push({ deal_id: d.hubspot_deal_id, property: prop, at: c.timestamp, value: String(c.value ?? "").slice(0, 200), by_user: by, source: c.sourceType || null, dog: d.dog_name, client: d.client_name });
      }
    }
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from("hubspot_changes").upsert(rows.slice(i, i + 200), { onConflict: "deal_id,property,at", ignoreDuplicates: true });
      if (error) { out.errors.push(error.message); break; }
    }
    out.changes = rows.length;
    await sb.from("app_settings").upsert({ key: "work.hubspotPulledAt", value: new Date().toISOString(), updated_by: "app", updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (rows.length) await auditSystem("Read HubSpot changes made by people", `${rows.length} change${rows.length === 1 ? "" : "s"} on ${out.deals} deals since ${since.slice(0, 10)}, for Pulse → Where the work goes.`).catch(() => null);
  } catch (e) { out.errors.push((e as Error).message); }
  return out;
}

// ── The report ──
export type WorkLine = { what: string; n: number; people: string[]; medianMin?: number | null; note?: string };
export type WorkView = {
  from: string; to: string;
  office: WorkLine[]; trainers: WorkLine[];
  reasons: { action: string; reason: string; n: number; people: string[] }[];
  hubspot: { property: string; n: number; people: string[]; last: string }[];
  byItself: { what: string; n: number }[];      // what the app did on its own in the same range
  rhythm: Rhythm[];                              // when each office person does things, hour by hour (Eastern)
  note: string;
};
/** When one person does things: actions per hour of the day (Eastern), and how many came within seconds of the one before. */
export type Rhythm = { who: string; total: number; hours: number[]; days: number; busiest: number; burstPct: number; lateNightPct: number };
const NOISE = /^(Signed in|Turned notifications|Sent themselves a test notification|Signed out)/i;
const etHour = (iso: string) => Number(new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false })) % 24;
const etDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
/** Office people only; the shared admin name is kept apart from named logins. */
export function rhythms(rows: { who: string | null; role: string | null; action: string; at: string }[]): Rhythm[] {
  const by = new Map<string, { at: string; action: string }[]>();
  for (const r of rows) {
    if (r.role !== "admin" || NOISE.test(r.action)) continue;
    const who = (r.who || "?").replace(/^Dogwise (Admin|team) \((.+)\)$/, "$2").replace(/@dogwiseacademy\.com$/, "");
    by.set(who, [...(by.get(who) || []), { at: r.at, action: r.action }]);
  }
  const out: Rhythm[] = [];
  for (const [who, list] of by) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    const hours = new Array(24).fill(0);
    let bursts = 0;
    list.forEach((x, i) => { hours[etHour(x.at)]++; if (i && Date.parse(x.at) - Date.parse(list[i - 1].at) <= 10000) bursts++; });
    const late = hours.slice(20).reduce((a, b) => a + b, 0) + hours.slice(0, 6).reduce((a, b) => a + b, 0);
    out.push({ who, total: list.length, hours, days: new Set(list.map((x) => etDay(x.at))).size, busiest: hours.indexOf(Math.max(...hours)),
      burstPct: list.length ? Math.round((bursts / list.length) * 100) : 0, lateNightPct: list.length ? Math.round((late / list.length) * 100) : 0 });
  }
  return out.sort((a, b) => b.total - a.total);
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)]); };
const minutes = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 60000);
const pretty = (action: string) => ({
  saveBooking: "Booked a dog", cancelBooking: "Cancelled a booking", postponeBooking: "Put a booking on standby", setTrainingPaused: "Paused or resumed training videos",
  approveReportAction: "Approved a form", requestChangesAction: "Sent a form back", waiveReportAction: "Marked a form not needed", missReportAction: "Marked a form missed (late)", unwaiveReportAction: "Brought a form back",
  reviewVaccinesAction: "Checked vaccine records", clearReadyAction: "Cleared a dog as ready", resolveIncidentAction: "Closed a To do item by hand", clientCloseAction: "Closed a client item (no reply needed / handled)",
  checkIn: "Checked in with a trainer from To do", messageTrainer: "Messaged a trainer", sendMessage: "Messaged a trainer", askAction: "Asked Pedro or a trainer", answerAskAction: "Answered an ask",
  confirmFollowupAction: "Set up a follow-up", logFollowupAction: "Logged a follow-up session", confirmMoveAction: "Confirmed a pickup or drop-off", submitReportAction: "Submitted a form",
  quoTest: "Tested Quo", setAiSettingAction: "Changed an AI switch", saveChecklistAction: "Changed a checklist", saveQuoNumberAction: "Saved a Quo number", requestFollowupSetupAction: "Asked for a dog to be added for follow-ups",
  approvePayslip: "Approved a payslip", savePayslip: "Edited a payslip", directEdit: "Edited a record directly"
} as Record<string, string>)[action] || action.replace(/Action$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/** What people did by hand over the range, office and trainers side by side, with reasons and HubSpot's own work. */
export async function workReport(from: string, to: string, sb: SupabaseClient = serviceClient()): Promise<WorkView> {
  const f = `${from}T00:00:00Z`, t = `${to}T23:59:59Z`;
  const [{ data: logRows }, { data: incs }, { data: reps }, { data: reasons }, { data: hs }, { data: msgs }, { data: sends }, { data: nudges }, { data: dec }] = await Promise.all([
    sb.from("audit_log").select("who, role, action, at").gte("at", f).lte("at", t).neq("role", "system").limit(20000),
    sb.from("chat_incidents").select("kind, opened_at, resolved_at, resolved_by, auto_resolved").gte("resolved_at", f).lte("resolved_at", t).eq("status", "resolved").limit(20000),
    sb.from("reports").select("status, submitted_at, approved_at, approved_by_name").gte("submitted_at", f).lte("submitted_at", t).limit(5000),
    sb.from("work_reasons").select("action, reason, who").gte("at", f).lte("at", t).limit(5000),
    sb.from("hubspot_changes").select("property, by_user, at").gte("at", f).lte("at", t).limit(10000),
    sb.from("chat_messages").select("sender_role, sender_name, kind").gte("created_at", f).lte("created_at", t).in("sender_role", ["trainer", "admin"]).not("sender_id", "is", null).limit(30000),
    sb.from("training_sends").select("deal_key").eq("status", "sent").gte("at", f).lte("at", t).limit(10000),
    sb.from("nudges").select("step, by").gte("sent_at", f).lte("sent_at", t).limit(20000),
    sb.from("ai_decisions").select("feature, auto").gte("at", f).lte("at", t).limit(20000)
  ]);
  const group = <T,>(rows: T[], key: (r: T) => string, who: (r: T) => string | null) => {
    const m = new Map<string, { n: number; people: Set<string> }>();
    for (const r of rows) { const k = key(r), g = m.get(k) || { n: 0, people: new Set<string>() }; g.n++; const w = who(r); if (w) g.people.add(w); m.set(k, g); }
    return [...m.entries()].map(([what, g]) => ({ what, n: g.n, people: [...g.people].sort() })).sort((a, b) => b.n - a.n);
  };
  const log = (logRows || []) as { who: string | null; role: string | null; action: string; at: string }[];
  const office: WorkLine[] = group(log.filter((r) => r.role === "admin"), (r) => pretty(r.action), (r) => r.who).map((x) => ({ ...x }));
  const trainersLog = group(log.filter((r) => r.role === "trainer"), (r) => pretty(r.action), (r) => r.who);
  // Chats: messages and media, by who wrote them
  const m = (msgs || []) as { sender_role: string; sender_name: string | null; kind: string }[];
  const tr = m.filter((x) => x.sender_role === "trainer"), ad = m.filter((x) => x.sender_role === "admin");
  const trainers: WorkLine[] = [
    { what: "Posted an update in a dog's chat (text)", n: tr.filter((x) => x.kind !== "media").length, people: [...new Set(tr.map((x) => x.sender_name || "?"))].sort() },
    { what: "Posted a photo or video", n: tr.filter((x) => x.kind === "media").length, people: [...new Set(tr.filter((x) => x.kind === "media").map((x) => x.sender_name || "?"))].sort() },
    ...trainersLog
  ].filter((x) => x.n > 0);
  if (ad.length) office.push({ what: "Wrote in a dog's chat", n: ad.length, people: [...new Set(ad.map((x) => x.sender_name || "?"))].sort() });
  // To do items closed by people, with how long they'd waited; and forms, submitted → approved
  const inc = ((incs || []) as { kind: string; opened_at: string; resolved_at: string; resolved_by: string | null; auto_resolved: boolean | null }[]);
  const byHand = inc.filter((i) => !i.auto_resolved && i.resolved_by && !/automatic|system|app/i.test(i.resolved_by));
  const kindsGrouped: WorkLine[] = group(byHand, (i) => `To do closed by hand: ${i.kind.replace(/_/g, " ")}`, (i) => i.resolved_by);
  for (const k of kindsGrouped) k.medianMin = median(byHand.filter((i) => `To do closed by hand: ${i.kind.replace(/_/g, " ")}` === k.what).map((i) => minutes(i.opened_at, i.resolved_at)));
  office.push(...kindsGrouped);
  const rp = ((reps || []) as { status: string; submitted_at: string; approved_at: string | null; approved_by_name: string | null }[]).filter((r) => r.approved_at && r.approved_by_name && !/automatic/i.test(r.approved_by_name));
  const fa = office.find((x) => x.what === "Approved a form"); if (fa) fa.medianMin = median(rp.map((r) => minutes(r.submitted_at, r.approved_at!)));
  office.sort((a, b) => b.n - a.n);
  // What the app did on its own, for the other side of the picture
  const byItself = [
    { what: "To do items that cleared themselves", n: inc.filter((i) => i.auto_resolved || /automatic/i.test(i.resolved_by || "")).length },
    { what: "Reminders sent to trainers", n: ((nudges || []) as { step: number | null; by: string }[]).filter((n) => n.by === "app" && n.step && n.step < 3).length },
    { what: "Training videos posted", n: (sends || []).length },
    { what: "Forms and vaccine checks approved by itself", n: ((dec || []) as { auto: boolean }[]).filter((d) => d.auto).length },
    { what: "Forms approved automatically", n: ((reps || []) as { approved_by_name: string | null }[]).filter((r) => /automatic/i.test(r.approved_by_name || "")).length }
  ].filter((x) => x.n > 0);
  const rs = group((reasons || []) as { action: string; reason: string; who: string | null }[], (r) => `${r.action}|${r.reason}`, (r) => r.who).map((x) => ({ action: x.what.split("|")[0], reason: x.what.split("|")[1], n: x.n, people: x.people }));
  const hrows = (hs || []) as { property: string; by_user: string | null; at: string }[];
  const hubspot = group(hrows, (r) => r.property, (r) => r.by_user).map((x) => ({ property: x.what, n: x.n, people: x.people, last: hrows.filter((r) => r.property === x.what).reduce((a, r) => (r.at > a ? r.at : a), "") }));
  return { from, to, office, trainers, reasons: rs, hubspot, byItself, rhythm: rhythms(log), note: hs === null ? "Run migration 059 in Supabase for reasons and HubSpot changes." : "" };
}

// ── People: how each office person works, hour by hour and day by day (a private page: /a/pulse/people) ──
export const canSeePeople = (email: string | null | undefined) =>
  !!email && (process.env.PEOPLE_INSIGHTS_EMAILS || "alma@dogwiseacademy.com").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());
export type Person = {
  who: string; total: number; days: number; burstPct: number; lateNightPct: number; busiest: number;
  grid: number[][];                              // [weekday 0 = Mon … 6 = Sun][hour 0-23], Eastern
  span: { first: string; last: string } | null;  // a typical day: median first and last action (Eastern, HH:MM)
  top: { action: string; n: number }[];
  hubspot: { n: number; top: string[] };         // deal properties they changed in HubSpot by hand, same range
  daily: { day: string; n: number }[];
};
const personKey = (who: string | null) => { const m = (who || "").match(/\(([^@()]+)@[^)]+\)/) || (who || "").match(/^([^@\s]+)@/); const k = m ? m[1] : (who || "?").split(" (")[0]; return k.charAt(0).toUpperCase() + k.slice(1); };
export async function peopleReport(from: string, to: string, sb: SupabaseClient = serviceClient()): Promise<Person[]> {
  const f = `${from}T00:00:00Z`, t = `${to}T23:59:59Z`;
  const rows: { who: string | null; role: string | null; action: string; at: string }[] = [];
  for (let i = 0; i < 20; i++) {
    const { data, error } = await sb.from("audit_log").select("who, role, action, at").eq("role", "admin").gte("at", f).lte("at", t).order("at").range(i * 1000, i * 1000 + 999);
    if (error || !data?.length) break;
    rows.push(...(data as typeof rows)); if (data.length < 1000) break;
  }
  const { data: hs } = await sb.from("hubspot_changes").select("property, by_user").gte("at", f).lte("at", t).limit(10000);
  const by = new Map<string, { at: string; action: string }[]>();
  for (const r of rows) { if (NOISE.test(r.action)) continue; const k = personKey(r.who); by.set(k, [...(by.get(k) || []), { at: r.at, action: r.action }]); }
  const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.round(mins % 60)).padStart(2, "0")}`;
  const minOfDay = (iso: string) => { const [h, m] = new Date(iso).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }).split(":").map(Number); return h * 60 + m; };
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const out: Person[] = [];
  for (const [who, list] of by) {
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0)), hours = new Array(24).fill(0);
    const perDay = new Map<string, number[]>(), acts = new Map<string, number>();
    let bursts = 0;
    list.forEach((x, i) => {
      const h = etHour(x.at), d = etDay(x.at), wd = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
      grid[wd][h]++; hours[h]++;
      perDay.set(d, [...(perDay.get(d) || []), minOfDay(x.at)]);
      acts.set(x.action, (acts.get(x.action) || 0) + 1);
      if (i && Date.parse(x.at) - Date.parse(list[i - 1].at) <= 10000) bursts++;
    });
    const late = hours.slice(20).reduce((a, b) => a + b, 0) + hours.slice(0, 6).reduce((a, b) => a + b, 0);
    const mine = ((hs || []) as { property: string; by_user: string | null }[]).filter((x) => (x.by_user || "").toLowerCase().includes(who.toLowerCase()));
    const props = new Map<string, number>(); for (const x of mine) props.set(x.property, (props.get(x.property) || 0) + 1);
    out.push({ who, total: list.length, days: perDay.size, burstPct: Math.round((bursts / list.length) * 100), lateNightPct: Math.round((late / list.length) * 100), busiest: hours.indexOf(Math.max(...hours)), grid,
      span: perDay.size ? { first: hhmm(med([...perDay.values()].map((v) => Math.min(...v)))), last: hhmm(med([...perDay.values()].map((v) => Math.max(...v)))) } : null,
      top: [...acts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([action, n]) => ({ action, n })),
      hubspot: { n: mine.length, top: [...props.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, n]) => `${p.replace(/_/g, " ")} ${n}`) },
      daily: [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, n: v.length })) });
  }
  return out.sort((a, b) => b.total - a.total);
}
