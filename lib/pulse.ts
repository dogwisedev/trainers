import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, isDemo } from "./supabase";
import { addDays, daysBetween, todayIso } from "./dates";
import { FORMS_CUTOVER } from "./reports";
import { closedWonBetween, countObjects, dealsCreatedBetween, etMidnight, hubspotConfigured, lostDealsBetween } from "./hubspot";
import { salesPeople } from "./sales";
import { chargeOutcomes, stripeConfigured } from "./stripe";
import { stateOf, US_TILES } from "./usTiles";
import { buildTodo } from "./todo";
import { dayET, delta, median, percentile, replyRuns, shrink, wilsonLower } from "./pulseMath";

// Pulse (the dashboard). One SNAPSHOT is pulled: the last 90 days plus the 90 before them (for comparisons), from the app's
// tables, HubSpot and Stripe, squeezed into a compact shape and kept for an hour. Every range and view is then worked out
// from the snapshot, so switching is instant. Refresh rebuilds the snapshot.
// Rules: quiet (Signal) chats and days before the Oct 23 cutover don't count against anyone. Times are waking hours,
// Eastern, medians not averages. Costs use only deals that carry Bark credits. Supabase returns at most 1,000 rows per
// request, so every read is paged (see `all`).

export type View = "office" | "trainers" | "sales";
/** key: the preset, or the nearest one for a custom range (some HubSpot figures are only counted per preset); exact: a preset was used as is. */
export type Range = { from: string; to: string; prevFrom: string; prevTo: string; days: number; label: string; key: string; exact: boolean };
export const PRESETS: { key: string; label: string; days: number }[] = [
  { key: "7d", label: "Last 7 days", days: 7 }, { key: "14d", label: "Last 14 days", days: 14 }, { key: "30d", label: "Last 30 days", days: 30 }, { key: "90d", label: "Last 90 days", days: 90 }
];
const SPAN = 90;

export function pulseRange(q: { r?: string; from?: string; to?: string }, today = todayIso()): Range {
  const iso = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const floor = addDays(today, -(SPAN - 1));
  let from = iso(q.from), to = iso(q.to) || today, label = "", key = "custom", exact = false;
  if (to > today) to = today;
  if (!from || from > to) { const p = PRESETS.find((x) => x.key === q.r) || PRESETS[1]; from = addDays(to, -(p.days - 1)); label = p.label; key = p.key; exact = to === today; }
  else label = `${from} to ${to}`;
  if (from < floor) { from = floor; label = `${from} to ${to} (the snapshot holds 90 days)`; }
  const days = daysBetween(from, to) + 1;
  if (key === "custom") key = PRESETS.reduce((best, p) => (Math.abs(p.days - days) < Math.abs(best.days - days) ? p : best), PRESETS[0]).key; // nearest preset, for figures only counted per preset
  return { from, to, prevFrom: addDays(from, -days), prevTo: addDays(from, -1), days, label, key, exact };
}

// ── The snapshot ─────────────────────────────────────────────────────────────
type SBooking = { id: string; t: string; deal: string | null; dog: string; client: string; start: string; end: string; status: string; created: string; cancelledOn: string | null; reason: string | null; note: string | null };
type SChat = { id: string; deal: string; t: string | null; quiet: boolean; joined: boolean; client: string; title: string };
type SRun = { d: string; m: number; by: "t" | "a" };
type SInc = { c: string | null; b: string | null; k: string; d: string; open: boolean; title: string; detail: string };
type SDeal = { st: string | null; day: string; closed: string | null; won: boolean; amount: number; credits: number; source: string; owner: string; reason: string; noTrainer: boolean };
type OwnerCounts = Record<string, Record<string, { calls: number; emails: number }>>;   // preset → owner id → counts
type SourceCounts = Record<string, Record<string, number>>;                              // preset → source → exact leads
/** HubSpot counts (sources, calls) are taken for these; 7 days uses the 14-day ones. */
const COUNT_KEYS = ["14d", "30d", "90d"];
export const countKey = (key: string) => (COUNT_KEYS.includes(key) ? key : key === "7d" ? "14d" : "90d");
export type Snapshot = {
  builtAt: string; today: string; from: string; points: number; ms: number; notes: string[];
  bookings: SBooking[]; trainers: { id: string; name: string; cap: number; active: boolean; state: string }[]; chats: SChat[];
  postDays: Record<string, string[]>; runs: Record<string, SRun[]>; lastStaff: Record<string, string>;
  incidents: SInc[]; reports: { t: string; d: string; ok: boolean }[]; timeOff: { t: string; start: string; end: string }[];
  dealMoney: { amount: number; day: string; owner: string }[]; hs: null | {
    created: SDeal[]; createdTotals: Record<string, { now: number; ly: number }>; won: SDeal[]; wonLY: SDeal[]; lost: SDeal[];
    monthLY: { label: string; n: number; amount: number; toDate: number; toDateAmount: number }; nextMonthLY: { label: string; n: number; amount: number };
    owners: { id: string; name: string }[]; ownerCounts: OwnerCounts; sourceCounts: SourceCounts; emailsLogged: boolean; sample: number;
  };
  failed: { customer: string; amount: number; day: string }[] | null; // customers whose LAST card attempt in the window failed
};

/** Every row, 1,000 at a time (Supabase's cap per request). */
async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 200; i++) {
    const { data, error } = await q(i * 1000, i * 1000 + 999);
    if (error) throw new Error(error.message);
    const rows = data || []; out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const day = (iso: string | null | undefined) => (iso ? dayET(iso) : "");

type AppPart = Omit<Snapshot, "hs" | "failed">;
/** The app's own tables for the window (every read paged). */
export async function buildAppPart(sb: SupabaseClient = serviceClient()): Promise<AppPart> {
  const t0 = Date.now(), today = todayIso(), from90 = addDays(today, -(SPAN - 1)), from = addDays(from90, -SPAN), notes: string[] = [];
  const [bks, trs, chats, msgs, incs, reps, offs, dm] = await Promise.all([
    all<{ id: string; trainer_id: string; hubspot_deal_id: string | null; dog_name: string | null; client_name: string; start_date: string; end_date: string; status: string; created_at: string; cancelled_at: string | null; cancel_reason: string | null; cancel_note: string | null }>((a, b) =>
      sb.from("bookings").select("id, trainer_id, hubspot_deal_id, dog_name, client_name, start_date, end_date, status, created_at, cancelled_at, cancel_reason, cancel_note").lte("start_date", today).gte("end_date", from).order("start_date").range(a, b)),
    all<{ id: string; name: string; capacity: number | null; active: boolean; state: string | null }>((a, b) => sb.from("trainers").select("id, name, capacity, active, state").order("name").range(a, b)),
    all<{ id: string; deal_key: string; trainer_id: string | null; quiet_at: string | null; client_user_id: string | null; client_name: string | null; title: string | null }>((a, b) => sb.from("chats").select("id, deal_key, trainer_id, quiet_at, client_user_id, client_name, title").order("created_at").range(a, b)),
    all<{ chat_id: string; sender_role: string; created_at: string }>((a, b) => sb.from("chat_messages").select("chat_id, sender_role, created_at").gte("created_at", `${from}T00:00:00Z`).in("kind", ["text", "media"]).order("created_at").range(a, b)),
    all<{ chat_id: string | null; booking_id: string | null; kind: string; opened_at: string; status: string; detail: string | null }>((a, b) => sb.from("chat_incidents").select("chat_id, booking_id, kind, opened_at, status, detail").gte("opened_at", `${from}T00:00:00Z`).order("opened_at").range(a, b)),
    all<{ trainer_id: string; due_by: string | null; submitted_at: string | null }>((a, b) => sb.from("reports").select("trainer_id, due_by, submitted_at").gte("submitted_at", `${from}T00:00:00Z`).order("submitted_at").range(a, b)),
    all<{ trainer_id: string; start_date: string; end_date: string }>((a, b) => sb.from("time_off").select("trainer_id, start_date, end_date").lte("start_date", today).gte("end_date", from).order("start_date").range(a, b)),
    all<{ amount: number; closed_on: string; owner_id: string | null }>((a, b) => sb.from("deal_money").select("amount, closed_on, owner_id").gte("closed_on", from).order("closed_on").range(a, b))
  ]);
  const reads = await all<{ chat_id: string; user_id: string }>((a, b) => sb.from("chat_reads").select("chat_id, user_id").order("chat_id").range(a, b));
  let points = bks.length + trs.length + chats.length + msgs.length + incs.length + reps.length + offs.length + dm.length + reads.length;

  // Chats, and what each one's messages add up to
  const joined = new Set(reads.filter((r) => chats.some((c) => c.id === r.chat_id && c.client_user_id === r.user_id)).map((r) => r.chat_id));
  const byChat = new Map<string, { role: string; at: string }[]>(), postDays: Record<string, string[]> = {}, lastStaff: Record<string, string> = {};
  for (const m of msgs) {
    if (!byChat.has(m.chat_id)) byChat.set(m.chat_id, []);
    byChat.get(m.chat_id)!.push({ role: m.sender_role, at: m.created_at });
    if (m.sender_role === "trainer") { const d = dayET(m.created_at); (postDays[m.chat_id] ||= []).includes(d) || postDays[m.chat_id].push(d); }
    if (m.sender_role === "trainer" || m.sender_role === "admin") lastStaff[m.chat_id] = m.created_at;
  }
  const runs: Record<string, SRun[]> = {};
  for (const [id, list] of byChat) runs[id] = replyRuns(list).map((r) => ({ d: dayET(r.askedAt), m: r.minutes, by: r.by === "trainer" ? "t" : "a" }));
  return {
    builtAt: new Date().toISOString(), today, from, points, ms: Date.now() - t0, notes,
    bookings: bks.map((b) => ({ id: b.id, t: b.trainer_id, deal: b.hubspot_deal_id, dog: b.dog_name || "Dog", client: b.client_name, start: b.start_date, end: b.end_date, status: b.status, created: day(b.created_at), cancelledOn: b.cancelled_at ? day(b.cancelled_at) : null, reason: b.cancel_reason, note: b.cancel_note })),
    trainers: trs.map((t) => ({ id: t.id, name: t.name, cap: Number(t.capacity || 0), active: !!t.active, state: clean(t.state).toUpperCase() })),
    chats: chats.map((c) => ({ id: c.id, deal: c.deal_key, t: c.trainer_id, quiet: !!c.quiet_at, joined: joined.has(c.id), client: c.client_name || "", title: c.title || "" })),
    postDays, runs, lastStaff,
    incidents: incs.map((i) => {
      const bk = i.booking_id ? bks.find((b) => b.id === i.booking_id) : null, ch = i.chat_id ? chats.find((c) => c.id === i.chat_id) : null;
      const title = bk ? `${bk.dog_name || "Dog"} (${bk.client_name})` : ch ? `${ch.title || "Dog"}${ch.client_name ? ` (${ch.client_name})` : ""}` : "";
      return { c: i.chat_id, b: i.booking_id, k: i.kind, d: dayET(i.opened_at), open: i.status !== "resolved", title: title.slice(0, 80), detail: clean(i.detail).slice(0, 120) };
    }),
    reports: reps.filter((r) => r.submitted_at && r.due_by && dayET(r.due_by) >= FORMS_CUTOVER).map((r) => ({ t: r.trainer_id, d: dayET(r.submitted_at!), ok: r.submitted_at! <= r.due_by! })),
    timeOff: offs.map((o) => ({ t: o.trainer_id, start: o.start_date, end: o.end_date })),
    dealMoney: dm.map((d) => ({ amount: Number(d.amount || 0), day: d.closed_on, owner: d.owner_id || "" }))
  };
}

/** HubSpot for the window: a few dozen requests, run in parallel. */
export async function buildHsPart(): Promise<{ hs: Snapshot["hs"]; points: number; notes: string[] }> {
  const today = todayIso(), from90 = addDays(today, -(SPAN - 1)), notes: string[] = [];
  let hs: Snapshot["hs"] = null, points = 0;
  if (hubspotConfigured()) {
    try {
      const lyFrom = addDays(from90, -365), lyTo = addDays(today, -365);
      const [ty, tm] = today.split("-").map(Number);
      const monthStart = `${ty}-${String(tm).padStart(2, "0")}-01`, monthEnd = addDays(tm === 12 ? `${ty + 1}-01-01` : `${ty}-${String(tm + 1).padStart(2, "0")}-01`, -1);
      const nmY = (tm === 12 ? ty + 1 : ty) - 1, nmM = tm === 12 ? 1 : tm + 1;
      const nmFrom = `${nmY}-${String(nmM).padStart(2, "0")}-01`, nmTo = addDays(nmM === 12 ? `${nmY + 1}-01-01` : `${nmY}-${String(nmM + 1).padStart(2, "0")}-01`, -1);
      const monthName = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
      const rng = (f: string, t: string) => [{ propertyName: "createdate", operator: "GTE", value: String(etMidnight(f)) }, { propertyName: "createdate", operator: "LT", value: String(etMidnight(addDays(t, 1))) }];
      const [created, won, wonLY, lost, monthLY, nextLY, people, ...totals] = await Promise.all([
        dealsCreatedBetween(from90, today, 20), closedWonBetween(from90, today, 6), closedWonBetween(lyFrom, lyTo, 6), lostDealsBetween(from90, today),
        closedWonBetween(addDays(monthStart, -365), addDays(monthEnd, -365), 5), closedWonBetween(nmFrom, nmTo, 5), salesPeople().catch(() => []),
        ...PRESETS.flatMap((p) => { const f = addDays(today, -(p.days - 1)); return [countObjects("deals", rng(f, today)).catch(() => 0), countObjects("deals", rng(addDays(f, -365), lyTo)).catch(() => 0)]; })
      ]);
      const compact = (d: { properties: Record<string, string | null> }, won: boolean): SDeal => {
        const p = d.properties, reason = clean(p.closed_lost_reason_new);
        return { st: stateOf(p.dealname), day: day(p.createdate) || day(p.closedate), closed: p.closedate ? day(p.closedate) : null, won, amount: Number(p.amount || 0), credits: Number(p.bark_credits_paid || 0),
          source: clean(p.lead_source) || "Unknown", owner: clean(p.hubspot_owner_id), reason, noTrainer: /local/i.test(reason) || p.dealstage === "173376666" || p.trainer_in_range === "false" };
      };
      const createdTotals: Record<string, { now: number; ly: number }> = {};
      PRESETS.forEach((p, i) => { createdTotals[p.key] = { now: totals[i * 2] as number, ly: totals[i * 2 + 1] as number }; });
      const toDate = addDays(today, -365);
      // Exact counts (searches queue at 3 a second): leads per source, calls per salesperson, for 14/30/90 days; emails for 90 days
      const ownerCounts: OwnerCounts = {}, sourceCounts: SourceCounts = {};
      const sources = [...new Set(created.rows.map((d) => clean(d.properties.lead_source) || "Unknown"))].slice(0, 6);
      const jobs: Promise<void>[] = [];
      for (const key of COUNT_KEYS) {
        const p = PRESETS.find((x) => x.key === key)!, f = addDays(today, -(p.days - 1)), ms = { from: String(etMidnight(f)), to: String(etMidnight(addDays(today, 1))) };
        ownerCounts[key] = {}; sourceCounts[key] = {};
        for (const src of sources) jobs.push(countObjects("deals", [...rng(f, today), src === "Unknown" ? { propertyName: "lead_source", operator: "NOT_HAS_PROPERTY" } : { propertyName: "lead_source", operator: "EQ", value: src }]).then((n) => { sourceCounts[key][src] = n; }).catch(() => {}));
        for (const o of people) {
          ownerCounts[key][o.id] = { calls: 0, emails: 0 };
          jobs.push(countObjects("calls", [{ propertyName: "hs_timestamp", operator: "GTE", value: ms.from }, { propertyName: "hs_timestamp", operator: "LT", value: ms.to }, { propertyName: "hubspot_owner_id", operator: "EQ", value: o.id }]).then((n) => { ownerCounts[key][o.id].calls = n; }).catch(() => {}));
          if (key === "90d") jobs.push(countObjects("emails", [{ propertyName: "hs_timestamp", operator: "GTE", value: ms.from }, { propertyName: "hs_timestamp", operator: "LT", value: ms.to }, { propertyName: "hubspot_owner_id", operator: "EQ", value: o.id }]).then((n) => { ownerCounts[key][o.id].emails = n; }).catch(() => {}));
        }
      }
      await Promise.all(jobs); // the queue in lib/hubspot.ts paces them
      const emailsLogged = Object.values(ownerCounts["90d"] || {}).some((c) => c.emails > 0);
      hs = { created: created.rows.map((d) => compact(d, d.properties.hs_is_closed_won === "true")), createdTotals, won: won.rows.map((d) => compact(d, true)), wonLY: wonLY.rows.map((d) => compact(d, true)), lost: lost.map((d) => compact(d, false)),
        monthLY: { label: monthName(monthStart), n: monthLY.total, amount: monthLY.rows.reduce((n, d) => n + Number(d.properties.amount || 0), 0), toDate: monthLY.rows.filter((d) => day(d.properties.closedate) <= toDate).length, toDateAmount: monthLY.rows.filter((d) => day(d.properties.closedate) <= toDate).reduce((n, d) => n + Number(d.properties.amount || 0), 0) },
        nextMonthLY: { label: monthName(nmFrom), n: nextLY.total, amount: nextLY.rows.reduce((n, d) => n + Number(d.properties.amount || 0), 0) },
        owners: people.map((o) => ({ id: o.id, name: o.name })), ownerCounts, sourceCounts, emailsLogged, sample: created.rows.length };
      points += created.rows.length + won.rows.length + wonLY.rows.length + lost.length + monthLY.rows.length + nextLY.rows.length;
    } catch (e) { notes.push(`HubSpot: ${(e as Error).message}`); }
  } else notes.push("HubSpot isn't set up here, so Sales is empty.");
  return { hs, points, notes };
}

/** Stripe for the window: whose last card attempt failed. */
export async function buildStripePart(): Promise<{ failed: Snapshot["failed"]; points: number; notes: string[] }> {
  const today = todayIso(), from90 = addDays(today, -(SPAN - 1)), notes: string[] = [];
  let failed: Snapshot["failed"] = null, points = 0;
  if (stripeConfigured()) {
    try {
      const charges = await chargeOutcomes(Math.floor(etMidnight(from90) / 1000), Math.floor(etMidnight(addDays(today, 1)) / 1000), 15);
      points += charges.length;
      const latest = new Map<string, { status: string; amount: number; created: number }>();
      for (const c of charges) { const cur = latest.get(c.customer); if (!cur || c.created > cur.created) latest.set(c.customer, c); }
      failed = [...latest.entries()].filter(([, c]) => c.status === "failed").map(([customer, c]) => ({ customer, amount: c.amount, day: dayET(c.created * 1000) }));
    } catch (e) { notes.push(`Stripe: ${(e as Error).message}`); }
  }
  return { failed, points, notes };
}

/** The whole snapshot: the three parts built in parallel. */
export async function buildSnapshot(sb: SupabaseClient = serviceClient()): Promise<Snapshot> {
  const t0 = Date.now();
  const [app, h, st] = await Promise.all([buildAppPart(sb), buildHsPart(), buildStripePart()]);
  return { ...app, hs: h.hs, failed: st.failed, points: app.points + h.points + st.points, ms: Date.now() - t0, notes: [...app.notes, ...h.notes, ...st.notes] };
}

// Each part is cached on its own (an hour; Refresh drops all three), and they're built in parallel, so the first load is as slow as the slowest part, not the sum.
const appCached = unstable_cache(async () => buildAppPart(), ["pulse-app-v4"], { revalidate: 3600, tags: ["pulse"] });
const hsCached = unstable_cache(async () => buildHsPart(), ["pulse-hs-v4"], { revalidate: 3600, tags: ["pulse"] });
const stripeCached = unstable_cache(async () => buildStripePart(), ["pulse-stripe-v4"], { revalidate: 3600, tags: ["pulse"] });
export async function snapshotCached(): Promise<Snapshot> {
  const t0 = Date.now();
  const [app, h, st] = await Promise.all([appCached(), hsCached(), stripeCached()]);
  return { ...app, hs: h.hs, failed: st.failed, points: app.points + h.points + st.points, ms: app.ms + (Date.now() - t0), notes: [...app.notes, ...h.notes, ...st.notes] };
}

// ── Views, derived from the snapshot ─────────────────────────────────────────
export type Tile = { key: string; label: string; value: string; sub: string; delta: { text: string; up: boolean | null }; good?: "up" | "down"; n?: string; how: string; spark: number[]; to?: string };
export type Card = { tone: "heart" | "biscuit" | "mint"; title: string; evidence: string; href?: string; action?: string; more?: { label: string; items: string[] } };
export type TrainerRow = {
  id: string; name: string; dogs: number; appDogs: number; careDays: number; postDays: number; updateRate: number | null; replyMedian: number | null; replyN: number;
  formsOnTime: number | null; formsN: number; alerts: number; utilisation: number | null; daysOff: number; cap: number; rank: number | null;
  score: number | null; baseline: number | null; confidence: "ok" | "low" | "none"; unusual: boolean; summary: string;
};
export type Move = { id: string; kind: "pickup" | "dropoff"; date: string; dog: string; client: string; trainer: string };
export type OfficeView = {
  joined: number; chats: number; silent24: { dog: string; client: string; trainer: string; hours: number; href: string }[];
  waitingClients: { client: string; dog: string; n: number; href: string }[]; slowTrainers: { name: string; alerts: number; href: string }[];
  newBookings: { name: string; n: number }[]; dateChanges: number; overbooked: number; moves: Move[];
  cancellations: { dog: string; client: string; trainer: string; reason: string; when: string }[];
  lateForms: { name: string; n: number }[]; balances: { text: string; href?: string }[]; incidents: { title: string; when: string; detail: string }[];
  counts: { todo: number; now: number; toReview: number; late: number; notBooked: number; notSignedIn: number };
};
export type StateCell = { st: string; leads: number; won: number; wonAmount: number; full: boolean };
export type SalesPerson = { name: string; leads: number; won: number; amount: number; calls: number; emails: number; conversion: number | null };
export type SalesView = {
  leads: number; leadsLY: number; won: number; wonAmount: number; wonLY: { n: number; amount: number }; conversion: number | null; conversionLY: number | null;
  perLead: string; perLeadN: number; perSale: string; perSaleN: number; creditUsd: number | null; closeDays: number | null; closeN: number;
  month: { label: string; n: number; amount: number; lyToDate: number; lyToDateAmount: number; lyFull: number; lyFullAmount: number }; nextMonth: { label: string; n: number; amount: number };
  bySource: { source: string; leads: number; won: number; conversion: number; perSale: string | null }[];
  states: StateCell[]; people: SalesPerson[]; peopleRange: string; emailsLogged: boolean;
  chart: { label: string; now: number; ly: number }[]; chartUnit: "day" | "week"; chartState: string | null;
  planLost: { n: number; amount: number }; failed: { n: number; amount: number } | null; coverage: { n: number; amount: number; where: string[]; bySource: { source: string; n: number }[] };
  sample: number; countKey: string;
};
export type Pulse = { range: Range; view: View; tiles: Tile[]; cards: Card[]; trainers: TrainerRow[]; office: OfficeView | null; sales: SalesView | null; notes: string[]; stats: { points: number; ms: number; at: string } };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (k: number, n: number) => (n ? Math.round((k / n) * 100) : null);
const label = (m: number) => (m < 60 ? `${m}m` : m < 720 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${Math.floor(m / 720)}d ${Math.floor((m % 720) / 60) ? `${Math.floor((m % 720) / 60)}h` : ""}`.trim());
const overlapDays = (aFrom: string, aTo: string, bFrom: string, bTo: string) => { const lo = aFrom > bFrom ? aFrom : bFrom, hi = aTo < bTo ? aTo : bTo; return hi >= lo ? daysBetween(lo, hi) + 1 : 0; };
function careDaysIn(b: { start: string; end: string }, from: string, to: string, today: string): string[] {
  const lo = [b.start, from, FORMS_CUTOVER].sort().pop()!, hi = [addDays(b.end, -1), to, today].sort()[0];
  const out: string[] = []; for (let d = lo; d <= hi; d = addDays(d, 1)) out.push(d); return out;
}

/** What a period of the snapshot adds up to. */
function period(s: Snapshot, from: string, to: string) {
  const live = s.bookings.filter((b) => b.status !== "cancelled");
  const chatByDeal = new Map(s.chats.map((c) => [c.deal, c])), chatById = new Map(s.chats.map((c) => [c.id, c]));
  const chatOf = (b: SBooking) => chatByDeal.get(b.deal || "") || chatByDeal.get(b.id) || null;
  const inCare = live.filter((b) => b.start <= to && b.end > from);
  let careDays = 0, postCount = 0;
  type PT = { dogs: Set<string>; care: number; post: number; replies: number[]; formsOk: number; formsN: number; alerts: number };
  const perTrainer = new Map<string, PT>();
  const t = (id: string): PT => { if (!perTrainer.has(id)) perTrainer.set(id, { dogs: new Set(), care: 0, post: 0, replies: [], formsOk: 0, formsN: 0, alerts: 0 }); return perTrainer.get(id)!; };
  for (const b of inCare) {
    const c = chatOf(b); if (!c || c.quiet) continue;
    const days = careDaysIn(b, from, to, s.today), posted = new Set(s.postDays[c.id] || []);
    const hit = days.filter((d) => posted.has(d)).length;
    careDays += days.length; postCount += hit;
    const x = t(b.t); x.dogs.add(b.id); x.care += days.length; x.post += hit;
  }
  const replies: number[] = [], team: number[] = [];
  for (const c of s.chats) {
    if (c.quiet) continue;
    for (const r of s.runs[c.id] || []) { if (r.d < from || r.d > to) continue; team.push(r.m); if (r.by === "t" && c.t) { replies.push(r.m); t(c.t).replies.push(r.m); } }
  }
  let formsOk = 0, formsN = 0;
  for (const r of s.reports) { if (r.d < from || r.d > to) continue; formsN++; if (r.ok) formsOk++; const x = t(r.t); x.formsN++; if (r.ok) x.formsOk++; }
  const inc = s.incidents.filter((i) => i.d >= from && i.d <= to && !(i.c && chatById.get(i.c)?.quiet));
  const waiting = inc.filter((i) => i.k === "client_waiting" || i.k === "client_pileup").length, silent = inc.filter((i) => i.k === "trainer_silent").length;
  for (const i of inc) { const c = i.c ? chatById.get(i.c) : null; if (c?.t && ["client_waiting", "client_pileup", "trainer_silent"].includes(i.k)) t(c.t).alerts++; }
  const started = live.filter((b) => b.start >= from && b.start <= to).length;
  const cancelled = s.bookings.filter((b) => b.cancelledOn && b.cancelledOn >= from && b.cancelledOn <= to).length;
  const sold = s.dealMoney.filter((d) => d.day >= from && d.day <= to);
  return { inCare: inCare.length, careDays, postCount, replyMedian: median(replies), replyP90: percentile(replies, 90), replyN: replies.length, teamMedian: median(team), teamN: team.length,
    formsOk, formsN, waiting, silent, started, cancelled, sales: sold.length, revenue: sold.reduce((n, d) => n + d.amount, 0), perTrainer, inc, chatOf, chatById, live };
}

/** A trainer's score for a period: updates 40, replies 25, forms 20, alerts 15; parts with no data drop out. */
function scoreOf(x: { care: number; post: number; replies: number[]; formsOk: number; formsN: number; alerts: number }, groupRate: number): number | null {
  if (!x.care) return null; // no dog-days in an app chat: nothing to score (a form alone isn't a score)
  const parts: [number, number][] = [];
  parts.push([shrink((x.post / x.care) * 100, x.care, groupRate * 100, 7), 40]);
  const m = median(x.replies); if (m != null) parts.push([Math.max(0, Math.min(100, 100 - ((m - 15) / 345) * 100)), 25]);
  if (x.formsN) parts.push([shrink((x.formsOk / x.formsN) * 100, x.formsN, 80, 3), 20]);
  if (x.care) parts.push([Math.max(0, 100 - x.alerts * 15), 15]);
  if (!parts.length) return null;
  const w = parts.reduce((n, [, k]) => n + k, 0);
  return Math.round(parts.reduce((n, [v, k]) => n + v * k, 0) / w);
}
function summaryOf(t: { updateRate: number | null; replyMedian: number | null; replyN: number; formsOnTime: number | null; formsN: number; alerts: number; careDays: number; dogs: number; daysOff: number; utilisation: number | null }): string {
  if (!t.careDays && !t.formsN && !t.replyN) return t.dogs ? "Dogs in care, but their chats are on Signal or not open yet." : "No dogs in this range.";
  const bits: string[] = [];
  if (t.updateRate != null) bits.push(t.updateRate >= 80 ? "posts almost every day" : t.updateRate >= 50 ? "posts most days" : t.updateRate >= 20 ? "posts some days" : "rarely posts in the app");
  if (t.replyMedian != null) bits.push(t.replyMedian <= 30 ? "replies within half an hour" : t.replyMedian <= 120 ? "replies within a couple of hours" : t.replyMedian <= 360 ? "replies within the day" : "slow to reply");
  else if (t.careDays) bits.push("no client questions to answer");
  if (t.formsN) bits.push(t.formsOnTime === 100 ? "forms on time" : (t.formsOnTime ?? 0) >= 70 ? "most forms on time" : "forms often late");
  if (t.alerts) bits.push(`${t.alerts} alert${t.alerts > 1 ? "s" : ""}`);
  if (t.utilisation != null && t.utilisation >= 90) bits.push("kennels full");
  if (t.daysOff >= 7) bits.push(`${t.daysOff} days off`);
  const s = bits.join(", "); return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

export async function pulse(q: { r?: string; from?: string; to?: string; v?: string; state?: string }, s?: Snapshot): Promise<Pulse> {
  const snap = s || await snapshotCached();
  const t0 = Date.now(), range = pulseRange(q, snap.today), notes = [...snap.notes];
  const view: View = (["office", "trainers", "sales"] as View[]).find((x) => x === q.v) || "office";
  if (isDemo()) return { range, view, tiles: [], cards: [], trainers: [], office: null, sales: null, notes: ["Demo mode: no data."], stats: { points: 0, ms: 0, at: snap.builtAt } };
  const now = period(snap, range.from, range.to), prev = period(snap, range.prevFrom, range.prevTo), base = period(snap, addDays(snap.today, -(SPAN - 1)), snap.today);
  const { live, chatOf, chatById } = now;
  const tName = (id: string) => snap.trainers.find((t) => t.id === id)?.name || "Trainer";

  // Sparklines
  const sparkFrom = addDays(range.to, -89), days90 = Array.from({ length: 90 }, (_, i) => addDays(sparkFrom, i));
  const careSpark = days90.map((d) => live.filter((b) => b.start <= d && b.end > d).length);
  const postSpark = days90.map((d) => Object.values(snap.postDays).filter((ds) => ds.includes(d)).length);
  const waitSpark = days90.map((d) => snap.incidents.filter((i) => i.k === "client_waiting" && i.d === d).length);
  const waitingNow = snap.incidents.filter((i) => i.open && (i.k === "client_waiting" || i.k === "client_pileup") && !(i.c && chatById.get(i.c)?.quiet)).length;
  const inCareNow = live.filter((b) => b.start <= range.to && b.end > range.to).length;
  const tiles: Tile[] = [
    { key: "care", label: "Dogs in care", value: String(inCareNow), sub: `${now.started} started, ${now.cancelled} cancelled`, delta: delta(now.started, prev.started), good: "up", how: "Dogs in care on the last day of the range. Started and cancelled are counted inside the range.", spark: careSpark, to: "/a/dogs" },
    { key: "update", label: "Daily updates", value: now.careDays ? `${pct(now.postCount, now.careDays)}%` : "–", sub: `${now.postCount} of ${now.careDays} dog-days had a post`, delta: delta(pct(now.postCount, now.careDays), pct(prev.postCount, prev.careDays)), good: "up", n: `${now.careDays} dog-days`, how: "Days a dog was in care (since the Oct 23 cutover) on which its trainer posted in the chat, over all such days. Quiet (Signal) chats left out.", spark: postSpark, to: "/a/chats" },
    { key: "reply", label: "Trainer reply time", value: now.replyMedian == null ? "–" : label(now.replyMedian), sub: now.replyN ? `median of ${now.replyN}; 90% within ${label(now.replyP90!)}` : "no client messages answered by trainers", delta: now.replyN >= 5 && prev.replyN >= 5 ? delta(now.replyMedian, prev.replyMedian, true) : { text: "", up: null }, good: "down", n: `${now.replyN} replies`, how: "From a client's first unanswered message to the trainer's reply, 8 AM–8 PM Eastern only. Median, not average. Office replies are in the team figure.", spark: [], to: "/a/chats" },
    { key: "team", label: "Team reply time", value: now.teamMedian == null ? "–" : label(now.teamMedian), sub: now.teamN ? `median of ${now.teamN} replies by anyone at Dogwise` : "no replies", delta: now.teamN >= 5 && prev.teamN >= 5 ? delta(now.teamMedian, prev.teamMedian, true) : { text: "", up: null }, good: "down", n: `${now.teamN} replies`, how: "Same as trainer reply time, but whoever at Dogwise replied first.", spark: [], to: "/a/chats" },
    { key: "forms", label: "Forms on time", value: now.formsN ? `${pct(now.formsOk, now.formsN)}%` : "–", sub: `${now.formsOk} of ${now.formsN} sent by the deadline`, delta: delta(pct(now.formsOk, now.formsN), pct(prev.formsOk, prev.formsN)), good: "up", n: `${now.formsN} forms`, how: "Intake forms, weekly checks and handover reports sent in during the range, on or before their deadline.", spark: [], to: "/a#todo-week" },
    { key: "waiting", label: "Clients waiting now", value: String(waitingNow), sub: `${now.waiting} left waiting in the range, ${now.silent} days with no update`, delta: delta(now.waiting, prev.waiting), good: "down", how: "Clients with an open \"waiting for a reply\" alert right now. The range figure counts every such alert raised in it (unanswered 3+ waking hours, or 3+ messages).", spark: waitSpark, to: "/a#todo-now" }
  ];

  // Trainers: everyone active, plus anyone else with dogs in the range
  const groupRate = now.careDays ? now.postCount / now.careDays : 0, baseRate = base.careDays ? base.postCount / base.careDays : 0;
  const isTest = (id: string) => /\btest\b/i.test(snap.trainers.find((t) => t.id === id)?.name || "");
  const ids = new Set([...snap.trainers.filter((t) => t.active).map((t) => t.id), ...now.perTrainer.keys()].filter((id) => !isTest(id)));
  const trainers: TrainerRow[] = [...ids].map((id) => {
    const x = now.perTrainer.get(id) || { dogs: new Set<string>(), care: 0, post: 0, replies: [] as number[], formsOk: 0, formsN: 0, alerts: 0 }, b = base.perTrainer.get(id);
    const tr = snap.trainers.find((t) => t.id === id), cap = tr?.cap || 0;
    const dogsAll = new Set(live.filter((bk) => bk.t === id && bk.start <= range.to && bk.end > range.from).map((bk) => bk.id));
    const daysOff = snap.timeOff.filter((o) => o.t === id).reduce((n, o) => n + overlapDays(o.start, o.end, range.from, range.to), 0);
    const allCare = live.filter((bk) => bk.t === id).reduce((n, bk) => n + overlapDays(bk.start, addDays(bk.end, -1), range.from, range.to), 0);
    const score = scoreOf(x, groupRate), baseline = b ? scoreOf(b, baseRate) : null;
    const row: TrainerRow = { id, name: tr?.name || tName(id), dogs: dogsAll.size, appDogs: x.dogs.size, careDays: x.care, postDays: x.post, updateRate: x.care ? Math.round((x.post / x.care) * 100) : null,
      replyMedian: median(x.replies), replyN: x.replies.length, formsOnTime: x.formsN ? Math.round((x.formsOk / x.formsN) * 100) : null, formsN: x.formsN, alerts: x.alerts,
      utilisation: cap ? Math.min(100, Math.round((allCare / (cap * range.days)) * 100)) : null, daysOff, cap, rank: null,
      score, baseline, confidence: score == null ? "none" : x.care < 14 || (x.replies.length < 5 && x.care < 21) ? "low" : "ok", unusual: score != null && baseline != null && b!.care >= 21 && Math.abs(score - baseline) >= 20, summary: "" };
    row.summary = summaryOf(row);
    return row;
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || wilsonLower(b.postDays, b.careDays) - wilsonLower(a.postDays, a.careDays) || a.name.localeCompare(b.name));
  let rk = 0; for (const t of trainers) t.rank = t.score != null && t.confidence !== "none" ? ++rk : null;

  // Office
  let office: OfficeView | null = null;
  if (view === "office") {
    const careNow = live.filter((b) => b.start <= range.to && b.end > range.to), chatsNow = careNow.map(chatOf).filter((c): c is SChat => !!c && !c.quiet);
    const joined = chatsNow.filter((c) => c.joined).length, nowMs = Date.now();
    const silent24 = careNow.flatMap((b) => { const c = chatOf(b); if (!c || c.quiet) return []; const last = snap.lastStaff[c.id] ? Date.parse(snap.lastStaff[c.id]) : Date.parse(`${b.start}T12:00:00Z`); const hours = Math.round((nowMs - last) / 3600000); return hours >= 24 ? [{ dog: b.dog, client: b.client, trainer: tName(b.t), hours, href: `/a/chats/${c.id}` }] : []; }).sort((a, b) => b.hours - a.hours);
    const wait = new Map<string, number>(); for (const i of now.inc) if ((i.k === "client_waiting" || i.k === "client_pileup") && i.c) wait.set(i.c, (wait.get(i.c) || 0) + 1);
    const waitingClients = [...wait.entries()].filter(([, n]) => n >= 2).map(([id, n]) => { const c = chatById.get(id); return { client: c?.client || "Client", dog: c?.title || "", n, href: `/a/chats/${id}` }; }).sort((a, b) => b.n - a.n);
    const bar = Math.max(5, Math.round(range.days / 2)); // "repeated": alerts on half the days or more
    const slowTrainers = trainers.filter((t) => t.alerts >= bar).map((t) => ({ name: t.name, alerts: t.alerts, href: `/a/trainers/${t.id}` })).sort((a, b) => b.alerts - a.alerts);
    const nb = new Map<string, number>(); for (const b of snap.bookings.filter((b) => b.created >= range.from && b.created <= range.to)) nb.set(b.t, (nb.get(b.t) || 0) + 1);
    const moves: Move[] = [...live.filter((b) => b.start >= range.from && b.start <= range.to).map((b) => ({ id: b.id, kind: "pickup" as const, date: b.start, dog: b.dog, client: b.client, trainer: tName(b.t) })),
      ...live.filter((b) => b.end >= range.from && b.end <= range.to).map((b) => ({ id: b.id, kind: "dropoff" as const, date: b.end, dog: b.dog, client: b.client, trainer: tName(b.t) }))].sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind));
    let counts = { todo: 0, now: 0, toReview: 0, late: 0, notBooked: 0, notSignedIn: 0 }, lateForms: OfficeView["lateForms"] = [], balances: OfficeView["balances"] = [];
    try {
      const t = await buildTodo(); const signin = t.items.find((i) => i.key === "signin");
      counts = { todo: t.items.length + (t.late.length ? 1 : 0) + (t.beforeApp.length ? 1 : 0), now: t.items.filter((i) => i.group === "now").length, toReview: t.items.filter((i) => i.key.startsWith("rep:")).length, late: t.late.length, notBooked: t.items.filter((i) => /closed won/i.test(i.text)).length, notSignedIn: signin ? Number((signin.text.match(/^(\d+)/) || [])[1] || 0) : 0 };
      const lf = new Map<string, number>(); for (const x of t.late) lf.set(x.trainerName || "Trainer", (lf.get(x.trainerName || "Trainer") || 0) + 1);
      lateForms = [...lf.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
      balances = t.items.filter((i) => /balance/i.test(i.detail || "") && /ready|start/i.test(i.text)).map((i) => ({ text: i.text, href: i.dogHref || i.primary?.href }));
    } catch (e) { notes.push(`To do: ${(e as Error).message}`); }
    office = { joined, chats: chatsNow.length, silent24, waitingClients, slowTrainers, newBookings: [...nb.entries()].map(([id, n]) => ({ name: tName(id), n })).sort((a, b) => b.n - a.n),
      dateChanges: now.inc.filter((i) => i.k === "length_changed").length, overbooked: now.inc.filter((i) => i.k === "overbooked").length, moves,
      cancellations: snap.bookings.filter((b) => b.cancelledOn && b.cancelledOn >= range.from && b.cancelledOn <= range.to).map((b) => ({ dog: b.dog, client: b.client, trainer: tName(b.t), reason: `${b.reason || "No reason recorded"}${b.note ? `: ${b.note}` : ""}`, when: b.cancelledOn! })).sort((a, b) => b.when.localeCompare(a.when)),
      lateForms, balances, incidents: now.inc.filter((i) => i.k === "trainer_report").map((i) => ({ title: i.title || "Incident", when: i.d, detail: i.detail })).sort((a, b) => b.when.localeCompare(a.when)), counts };
  }

  // Sales
  let sales: SalesView | null = null;
  if (view === "sales" && snap.hs) {
    const h = snap.hs, inR = (d: string) => d >= range.from && d <= range.to, lyR = (d: string) => d >= addDays(range.from, -365) && d <= addDays(range.to, -365);
    const created = h.created.filter((d) => inR(d.day)), won = h.won.filter((d) => inR(d.closed || "")), wonLY = h.wonLY.filter((d) => lyR(d.closed || "")), lost = h.lost.filter((d) => inR(d.day));
    const totals = range.exact ? h.createdTotals[range.key] : null;
    // The lead total is exact (HubSpot's count). The newest `sample` leads are what the snapshot holds in detail: their shares
    // are scaled to the total for the map and for people; sources get exact counts; credits are measured per lead on the sample.
    const leads = totals?.now || created.length, leadsLY = totals?.ly || 0, scale = created.length ? leads / created.length : 1;
    const ck = countKey(range.key), srcExact = h.sourceCounts[ck] || {};
    const st = q.state || null;
    const sel = <T extends { st: string | null }>(xs: T[]) => (st ? xs.filter((x) => x.st === st) : xs);
    const creditUsd = Number(process.env.BARK_CREDIT_USD || 0) || null, fmt = (n: number) => (creditUsd ? money(n * creditUsd) : `${Math.round(n * 10) / 10} cr`);
    // Per source: exact leads, credits per lead (on the sample), spend = that × exact leads, cost per sale = spend ÷ won deals with credits
    const srcS = new Map<string, { sample: number; credits: number; creditLeads: number; won: number; wonCredits: number }>();
    const srcGet = (k: string) => { if (!srcS.has(k)) srcS.set(k, { sample: 0, credits: 0, creditLeads: 0, won: 0, wonCredits: 0 }); return srcS.get(k)!; };
    for (const d of created) { const x = srcGet(d.source); x.sample++; if (d.credits > 0) { x.credits += d.credits; x.creditLeads++; } }
    for (const d of won) { const x = srcGet(d.source); x.won++; if (d.credits > 0) x.wonCredits++; }
    const srcLeads = (k: string, x: { sample: number }) => (range.exact && srcExact[k] != null ? srcExact[k] : Math.round(x.sample * scale));
    const srcSpend = (k: string, x: { sample: number; credits: number; creditLeads: number }) => (x.sample ? (x.credits / x.sample) * srcLeads(k, x) : 0); // credits per lead on the sample × real leads
    let spend = 0, creditLeadsAll = 0, wonCredits = 0;
    for (const [k, x] of srcS) { spend += srcSpend(k, x); creditLeadsAll += x.sample ? Math.round((x.creditLeads / x.sample) * srcLeads(k, x)) : 0; wonCredits += x.wonCredits; }
    // Map: leads per state (the sample's share, scaled to the total) and sales; "full" = that state's active trainers' kennels are 80%+ used today
    const cells = new Map<string, StateCell>(), cell = (x: string) => { if (!cells.has(x)) cells.set(x, { st: x, leads: 0, won: 0, wonAmount: 0, full: false }); return cells.get(x)!; };
    for (const d of created) if (d.st) cell(d.st).leads++;
    for (const c of cells.values()) c.leads = Math.round(c.leads * scale);
    for (const d of won) if (d.st) { const c = cell(d.st); c.won++; c.wonAmount += d.amount; }
    for (const t of US_TILES) {
      const trs = snap.trainers.filter((x) => x.active && x.state === t.st), cap = trs.reduce((n, x) => n + x.cap, 0);
      if (!cap) continue;
      const used = live.filter((b) => trs.some((x) => x.id === b.t) && b.start <= snap.today && b.end > snap.today).length;
      if (used / cap >= 0.8) cell(t.st).full = true;
    }
    // Chart: sales per day (short ranges) or per week, this range against the same dates last year, for the chosen state
    const unit: "day" | "week" = range.days > 21 ? "week" : "day", buckets: { label: string; now: number; ly: number }[] = [];
    for (let d = range.from; d <= range.to; d = addDays(d, unit === "day" ? 1 : 7)) {
      const end = unit === "day" ? d : [addDays(d, 6), range.to].sort()[0];
      const inB = (x: string) => x >= d && x <= end, inBLY = (x: string) => x >= addDays(d, -365) && x <= addDays(end, -365);
      buckets.push({ label: unit === "day" ? d.slice(5).replace("-", "/") : `${d.slice(5).replace("-", "/")}–${end.slice(5).replace("-", "/")}`, now: sel(won).filter((x) => inB(x.closed || "")).length, ly: sel(h.wonLY).filter((x) => inBLY(x.closed || "")).length });
    }
    const pc = h.ownerCounts[ck] || {};
    const wonByOwner = new Map<string, { n: number; amount: number }>(); for (const d of snap.dealMoney.filter((d) => inR(d.day))) { const x = wonByOwner.get(d.owner) || { n: 0, amount: 0 }; x.n++; x.amount += d.amount; wonByOwner.set(d.owner, x); }
    const people: SalesPerson[] = h.owners.map((o) => {
      const c = pc[o.id] || { calls: 0, emails: 0 }, w = wonByOwner.get(o.id) || { n: 0, amount: 0 }, ol = Math.round(created.filter((d) => d.owner === o.id).length * scale);
      return { name: o.name, leads: ol, won: w.n, amount: w.amount, calls: c.calls, emails: c.emails, conversion: ol ? Math.round((w.n / ol) * 1000) / 10 : null };
    }).filter((p) => p.leads || p.won || p.calls || p.emails).sort((a, b) => b.amount - a.amount || b.won - a.won);
    const planLost = lost.filter((d) => /payment plan/i.test(d.reason)), coverage = lost.filter((d) => d.noTrainer);
    const covWhere = new Map<string, number>(), covSrc = new Map<string, number>();
    for (const d of coverage) { if (d.st) covWhere.set(d.st, (covWhere.get(d.st) || 0) + 1); covSrc.set(d.source, (covSrc.get(d.source) || 0) + 1); }
    const failedIn = (snap.failed || []).filter((f) => inR(f.day));
    const closeDaysArr = won.filter((d) => d.day && d.closed).map((d) => Math.max(0, daysBetween(d.day, d.closed!)));
    sales = {
      leads, leadsLY, won: won.length, wonAmount: won.reduce((n, d) => n + d.amount, 0), wonLY: { n: wonLY.length, amount: wonLY.reduce((n, d) => n + d.amount, 0) },
      conversion: leads ? Math.round((won.length / leads) * 1000) / 10 : null, conversionLY: leadsLY ? Math.round((wonLY.length / leadsLY) * 1000) / 10 : null,
      perLead: creditLeadsAll ? fmt(spend / creditLeadsAll) : "–", perLeadN: creditLeadsAll, perSale: wonCredits ? fmt(spend / wonCredits) : "–", perSaleN: wonCredits, creditUsd,
      closeDays: median(closeDaysArr), closeN: closeDaysArr.length,
      month: (() => { const ms = `${snap.today.slice(0, 7)}-01`; const m = h.won.filter((d) => (d.closed || "") >= ms && (d.closed || "") <= snap.today); return { label: h.monthLY.label, n: m.length, amount: m.reduce((n, d) => n + d.amount, 0), lyToDate: h.monthLY.toDate, lyToDateAmount: h.monthLY.toDateAmount, lyFull: h.monthLY.n, lyFullAmount: h.monthLY.amount }; })(),
      nextMonth: h.nextMonthLY,
      bySource: [...srcS.entries()].map(([source, x]) => { const l = srcLeads(source, x); return { source, leads: l, won: x.won, conversion: l ? Math.round((x.won / l) * 1000) / 10 : 0, perSale: x.wonCredits && x.credits ? fmt(srcSpend(source, x) / x.wonCredits) : null }; }).sort((a, b) => b.leads - a.leads).slice(0, 8),
      states: [...cells.values()], people, peopleRange: PRESETS.find((p) => p.key === ck)?.label || range.label, emailsLogged: h.emailsLogged,
      chart: buckets, chartUnit: unit, chartState: st,
      planLost: { n: planLost.length, amount: planLost.reduce((n, d) => n + d.amount, 0) }, failed: snap.failed ? { n: failedIn.length, amount: failedIn.reduce((n, f) => n + f.amount, 0) } : null,
      coverage: { n: coverage.length, amount: coverage.reduce((n, d) => n + d.amount, 0), where: [...covWhere.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} (${n})`), bySource: [...covSrc.entries()].map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n) },
      sample: h.sample, countKey: ck
    };
  } else if (view === "sales" && !snap.hs && !notes.some((n) => /HubSpot/.test(n))) notes.push("Sales needs HubSpot.");

  // Decision cards
  const cards: Card[] = [];
  if (view !== "sales") {
    for (const t of trainers.filter((t) => t.appDogs >= 2 && t.careDays >= 7 && (t.updateRate ?? 100) < 60).slice(0, 2)) cards.push({ tone: "heart", title: `${t.name}: updates on ${t.updateRate}% of days with ${t.appDogs} dogs in app chats`, evidence: `${t.postDays} of ${t.careDays} dog-days had a post. Clients were promised one a day.`, href: `/a/trainers/${t.id}`, action: "Open trainer" });
    if (waitingNow >= 3) cards.push({ tone: "heart", title: `${waitingNow} clients are waiting for a reply right now`, evidence: `Team reply median ${now.teamMedian == null ? "–" : label(now.teamMedian)} in this range.`, href: "/a#todo-now", action: "See To do" });
    if (now.started && now.cancelled / Math.max(1, now.started) > 0.15) cards.push({ tone: "heart", title: `${now.cancelled} cancelled against ${now.started} started`, evidence: "More than 15% cancelled in this range. Reasons are on the bookings.", href: "/a/dogs", action: "See bookings" });
    if (now.formsN >= 10 && pct(now.formsOk, now.formsN)! < 70) cards.push({ tone: "biscuit", title: `Forms on time: ${pct(now.formsOk, now.formsN)}%`, evidence: `${now.formsN - now.formsOk} of ${now.formsN} forms were late.`, href: "/a#todo-week", action: "See late forms" });
  } else if (sales) {
    if (sales.planLost.n >= 2) cards.push({ tone: "biscuit", title: `${sales.planLost.n} people weren't approved for a payment plan (${money(sales.planLost.amount)})`, evidence: "Try splitting the cost into two smaller plans before these go cold." });
    if (sales.failed && sales.failed.n >= 2) cards.push({ tone: "heart", title: `${sales.failed.n} customers' last card payment failed (${money(sales.failed.amount)})`, evidence: "From Stripe: their most recent attempt in the range didn't go through and nothing succeeded after it. Worth a call." });
    if (sales.coverage.n >= 3) cards.push({ tone: "biscuit", title: `${sales.coverage.n} deals lost for lack of a nearby trainer (${money(sales.coverage.amount)})`, evidence: `Where: ${sales.coverage.where.join(", ")}.`, more: { label: "By lead source", items: sales.coverage.bySource.map((x) => `${x.source}: ${x.n}`) } });
    if (sales.wonLY.n && sales.won < sales.wonLY.n * 0.7) cards.push({ tone: "heart", title: `Sales are ${Math.round((1 - sales.won / sales.wonLY.n) * 100)}% below the same dates last year`, evidence: `${sales.won} now against ${sales.wonLY.n} then.` });
  }
  if (!cards.length) cards.push({ tone: "mint", title: "Nothing needs a decision in this range", evidence: "Everything is inside its usual bands." });

  return { range, view, tiles, cards: cards.slice(0, 5), trainers, office, sales, notes, stats: { points: snap.points, ms: snap.ms + (Date.now() - t0), at: snap.builtAt } };
}
