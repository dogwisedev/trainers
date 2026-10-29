import "server-only";
import { unstable_cache } from "next/cache";
import { serviceClient, isDemo } from "./supabase";
import { addDays, daysBetween, todayIso } from "./dates";
import { FORMS_CUTOVER } from "./reports";
import { closedWonBetween, countObjects, dealsCreatedBetween, etMidnight, hubspotConfigured, lostDealsBetween } from "./hubspot";
import { salesPeople } from "./sales";
import { failedCharges, stripeConfigured } from "./stripe";
import { stateOf } from "./usTiles";
import { buildTodo } from "./todo";
import { dayET, delta, median, percentile, replyRuns, wilsonLower } from "./pulseMath";

// Pulse: the dashboard's numbers for a date range, compared with the period before. Three views:
//  Office: the link between clients and trainers, and whether it's going smoothly (Pedro's weekly list lives here).
//  Trainers: how each trainer is doing, and earning: updates, replies, forms, alerts, utilisation, days off, pay.
//  Sales: where leads come from and close, what they cost, how this range compares with last year, and each salesperson.
// Rules: quiet (Signal) chats and days before the Oct 23 cutover don't count against anyone. Times are waking hours, Eastern.
// Costs use only deals that carry Bark credits: nothing is guessed.

export type View = "office" | "trainers" | "sales";
export type Range = { from: string; to: string; prevFrom: string; prevTo: string; days: number; label: string };
export const PRESETS: { key: string; label: string; days: number }[] = [
  { key: "7d", label: "Last 7 days", days: 7 }, { key: "14d", label: "Last 14 days", days: 14 }, { key: "30d", label: "Last 30 days", days: 30 }, { key: "90d", label: "Last 90 days", days: 90 }
];
export function pulseRange(q: { r?: string; from?: string; to?: string }): Range {
  const today = todayIso();
  const iso = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  let from = iso(q.from), to = iso(q.to) || today, label = "";
  if (!from || from > to) { const p = PRESETS.find((x) => x.key === q.r) || PRESETS[1]; from = addDays(to, -(p.days - 1)); label = p.label; }
  else label = `${from} to ${to}`;
  const days = daysBetween(from, to) + 1;
  return { from, to, prevFrom: addDays(from, -days), prevTo: addDays(from, -1), days, label };
}

type BookingRow = { id: string; trainer_id: string; hubspot_deal_id: string | null; dog_name: string | null; client_name: string; start_date: string; end_date: string; status: string; created_at: string; cancelled_at?: string | null; cancel_reason?: string | null; cancel_note?: string | null; program: string | null; trainers: { name: string } | null };
type ChatRow = { id: string; deal_key: string; trainer_id: string | null; quiet_at?: string | null; client_user_id: string | null; client_name: string | null; title: string | null; status: string };
type MsgRow = { chat_id: string; sender_role: string; kind: string; created_at: string };
type IncRow = { chat_id: string | null; booking_id: string | null; kind: string; opened_at: string; status: string; detail: string | null; title?: string | null };

export type Tile = { key: string; label: string; value: string; sub: string; delta: { text: string; up: boolean | null }; good?: "up" | "down"; n?: string; how: string; spark: number[]; to?: string };
export type Card = { tone: "heart" | "biscuit" | "mint"; title: string; evidence: string; href?: string; action?: string };
export type TrainerRow = {
  id: string; name: string; dogs: number; careDays: number; postDays: number; updateRate: number | null; updateLow: number; replyMedian: number | null; replyN: number;
  formsOnTime: number | null; formsN: number; alerts: number; pay: number; weeks: number; rank: number | null; utilisation: number | null; daysOff: number; capacity: number;
};
export type OfficeView = {
  joined: number; chats: number;
  silent24: { dog: string; client: string; trainer: string; hours: number; href: string }[];
  waitingClients: { client: string; dog: string; n: number; href?: string }[];        // clients below the promised frequency (2+ waiting alerts)
  slowTrainers: { name: string; alerts: number; href: string }[];                     // trainers with repeated comms alerts (3+)
  newBookings: { name: string; n: number }[]; dateChanges: number; overbooked: number;
  cancellations: { dog: string; client: string; trainer: string; reason: string; when: string }[];
  lateForms: { name: string; n: number }[];
  balances: { text: string; href?: string }[];
  incidents: { title: string; when: string; detail: string }[];
  counts: { todo: number; now: number; toReview: number; late: number; notBooked: number; notSignedIn: number };
};
export type StateCell = { st: string; created: number; won: number; wonAmount: number; credits: number; coverageLost: number };
export type SalesPerson = { name: string; leads: number; won: number; amount: number; calls: number; emails: number };
export type SalesView = {
  leads: number; leadsLastYear: number | null; won: number; wonAmount: number; wonLastYear: { n: number; amount: number } | null;
  conversion: number | null; perLead: string; perLeadN: number; perSale: string; perSaleN: number; creditUsd: number | null;
  closeDays: number | null; closeN: number; nextMonth: { label: string; n: number; amount: number } | null;
  bySource: { source: string; created: number; won: number; credits: number }[];
  states: StateCell[]; people: SalesPerson[];
  planLost: { n: number; amount: number }; failed: { n: number; amount: number } | null; mapCapped: boolean;
};
export type Pulse = {
  range: Range; view: View; tiles: Tile[]; cards: Card[]; trainers: TrainerRow[];
  office: OfficeView | null; sales: SalesView | null; notes: string[];
  stats: { points: number; ms: number; at: string };
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (k: number, n: number) => (n ? Math.round((k / n) * 100) : null);
const label = (m: number) => (m < 60 ? `${m}m` : m < 720 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${Math.floor(m / 720)}d ${Math.floor((m % 720) / 60) ? `${Math.floor((m % 720) / 60)}h` : ""}`.trim());
/** Days of a booking inside [from, to], up to today, and not before the cutover (the "daily update" promise starts there). */
function careDaysIn(b: { start_date: string; end_date: string }, from: string, to: string): string[] {
  const lo = [b.start_date, from, FORMS_CUTOVER].sort().pop()!, hi = [addDays(b.end_date, -1), to, todayIso()].sort()[0];
  const out: string[] = [];
  for (let d = lo; d <= hi; d = addDays(d, 1)) out.push(d);
  return out;
}
const overlapDays = (aFrom: string, aTo: string, bFrom: string, bTo: string) => { const lo = aFrom > bFrom ? aFrom : bFrom, hi = aTo < bTo ? aTo : bTo; return hi >= lo ? daysBetween(lo, hi) + 1 : 0; };

export async function pulse(q: { r?: string; from?: string; to?: string; v?: string }): Promise<Pulse> {
  const range = pulseRange(q), notes: string[] = [];
  const view: View = (["office", "trainers", "sales"] as View[]).find((x) => x === q.v) || "office";
  const t0 = Date.now(); let points = 0;
  const empty: Pulse = { range, view, tiles: [], cards: [], trainers: [], office: null, sales: null, notes: ["Demo mode: no data."], stats: { points: 0, ms: 0, at: new Date().toISOString() } };
  if (isDemo()) return empty;
  const sb = serviceClient();
  const sparkFrom = addDays(range.to, -89);
  const loadFrom = [range.prevFrom, sparkFrom].sort()[0];

  const [{ data: bks }, { data: chats }, { data: msgs }, { data: incs }, { data: reps }, { data: slips }, { data: deals }, { data: offs }, { data: trs }] = await Promise.all([
    sb.from("bookings").select("id, trainer_id, hubspot_deal_id, dog_name, client_name, start_date, end_date, status, created_at, cancelled_at, cancel_reason, cancel_note, program, trainers(name)").lte("start_date", range.to).gte("end_date", loadFrom),
    sb.from("chats").select("id, deal_key, trainer_id, quiet_at, client_user_id, client_name, title, status"),
    sb.from("chat_messages").select("chat_id, sender_role, kind, created_at").gte("created_at", `${loadFrom}T00:00:00Z`).lte("created_at", `${addDays(range.to, 1)}T12:00:00Z`).in("kind", ["text", "media"]).limit(20000),
    sb.from("chat_incidents").select("chat_id, booking_id, kind, opened_at, status, detail, title").gte("opened_at", `${loadFrom}T00:00:00Z`),
    sb.from("reports").select("trainer_id, kind, due_by, submitted_at, status").gte("submitted_at", `${range.prevFrom}T00:00:00Z`).lte("submitted_at", `${addDays(range.to, 1)}T12:00:00Z`),
    sb.from("payslips").select("trainer_id, total, status, pay_runs(period_start, period_end)"),
    sb.from("deal_money").select("deal_id, amount, closed_on, owner_id").gte("closed_on", range.prevFrom).lte("closed_on", range.to),
    sb.from("time_off").select("trainer_id, start_date, end_date").lte("start_date", range.to).gte("end_date", range.from),
    sb.from("trainers").select("id, name, capacity, active")
  ]);
  points += [bks, chats, msgs, incs, reps, slips, deals, offs, trs].reduce((n, x) => n + (x?.length || 0), 0);
  const bookings = ((bks || []) as unknown as BookingRow[]);
  const live = bookings.filter((b) => b.status !== "cancelled");
  const chatList = (chats || []) as ChatRow[];
  const chatByDeal = new Map(chatList.map((c) => [c.deal_key, c]));
  const chatOf = (b: BookingRow) => chatByDeal.get(b.hubspot_deal_id || "") || chatByDeal.get(b.id) || null;
  const messages = (msgs || []) as MsgRow[];
  const incidents = (incs || []) as IncRow[];
  const quiet = new Set(chatList.filter((c) => c.quiet_at).map((c) => c.id));
  const trainerRows = (trs || []) as { id: string; name: string; capacity: number | null; active: boolean }[];
  const trainerName = (id: string) => trainerRows.find((t) => t.id === id)?.name || bookings.find((b) => b.trainer_id === id)?.trainers?.name || "Trainer";

  // ── Posts per chat per Eastern day (trainer updates), and messages per chat ──
  const postDays = new Map<string, Set<string>>(), byChat = new Map<string, { role: string; at: string }[]>();
  for (const m of messages) {
    if (m.sender_role === "trainer") { if (!postDays.has(m.chat_id)) postDays.set(m.chat_id, new Set()); postDays.get(m.chat_id)!.add(dayET(m.created_at)); }
    if (!byChat.has(m.chat_id)) byChat.set(m.chat_id, []);
    byChat.get(m.chat_id)!.push({ role: m.sender_role, at: m.created_at });
  }

  // ── Per period ──
  const period = (from: string, to: string) => {
    const inCare = live.filter((b) => b.start_date <= to && b.end_date > from);
    let careDays = 0, postCount = 0;
    const perTrainer = new Map<string, { dogs: Set<string>; care: number; post: number; replies: number[]; formsOk: number; formsN: number; alerts: number }>();
    const t = (id: string) => { if (!perTrainer.has(id)) perTrainer.set(id, { dogs: new Set(), care: 0, post: 0, replies: [], formsOk: 0, formsN: 0, alerts: 0 }); return perTrainer.get(id)!; };
    for (const b of inCare) {
      const c = chatOf(b);
      if (!c || quiet.has(c.id)) continue;
      const days = careDaysIn(b, from, to), posted = postDays.get(c.id) || new Set<string>();
      const hit = days.filter((d) => posted.has(d)).length;
      careDays += days.length; postCount += hit;
      const x = t(b.trainer_id); x.dogs.add(b.id); x.care += days.length; x.post += hit;
    }
    const replies: number[] = [], team: number[] = [];
    for (const c of chatList) {
      if (quiet.has(c.id)) continue;
      for (const r of replyRuns(byChat.get(c.id) || [])) {
        const d = dayET(r.askedAt); if (d < from || d > to) continue;
        team.push(r.minutes);
        if (r.by === "trainer" && c.trainer_id) { replies.push(r.minutes); t(c.trainer_id).replies.push(r.minutes); }
      }
    }
    let formsOk = 0, formsN = 0;
    for (const r of (reps || []) as { trainer_id: string; due_by: string | null; submitted_at: string | null; status: string }[]) {
      if (!r.submitted_at || !r.due_by) continue;
      const d = dayET(r.submitted_at); if (d < from || d > to || dayET(r.due_by) < FORMS_CUTOVER) continue;
      formsN++; const ok = r.submitted_at <= r.due_by; if (ok) formsOk++;
      const x = t(r.trainer_id); x.formsN++; if (ok) x.formsOk++;
    }
    const inc = incidents.filter((i) => { const d = dayET(i.opened_at); return d >= from && d <= to && !(i.chat_id && quiet.has(i.chat_id)); });
    const waiting = inc.filter((i) => i.kind === "client_waiting" || i.kind === "client_pileup").length, silent = inc.filter((i) => i.kind === "trainer_silent").length;
    for (const i of inc) { const c = chatList.find((x) => x.id === i.chat_id); if (c?.trainer_id && ["client_waiting", "client_pileup", "trainer_silent"].includes(i.kind)) t(c.trainer_id).alerts++; }
    const started = live.filter((b) => b.start_date >= from && b.start_date <= to).length;
    const cancelled = bookings.filter((b) => b.status === "cancelled" && b.cancelled_at && dayET(b.cancelled_at) >= from && dayET(b.cancelled_at) <= to).length;
    const sold = ((deals || []) as { amount: number; closed_on: string }[]).filter((d) => d.closed_on >= from && d.closed_on <= to);
    return { inCare: inCare.length, careDays, postCount, replyMedian: median(replies), replyP90: percentile(replies, 90), replyN: replies.length, teamMedian: median(team), teamN: team.length,
      formsOk, formsN, waiting, silent, started, cancelled, sales: sold.length, revenue: sold.reduce((n, d) => n + Number(d.amount || 0), 0), perTrainer, inc };
  };
  const now = period(range.from, range.to), prev = period(range.prevFrom, range.prevTo);

  // ── Sparklines ──
  const days90 = Array.from({ length: 90 }, (_, i) => addDays(sparkFrom, i));
  const careSpark = days90.map((d) => live.filter((b) => b.start_date <= d && b.end_date > d).length);
  const postSpark = days90.map((d) => { let n = 0; for (const [, set] of postDays) if (set.has(d)) n++; return n; });
  const waitSpark = days90.map((d) => incidents.filter((i) => i.kind === "client_waiting" && dayET(i.opened_at) === d).length);

  const inCareNow = live.filter((b) => b.start_date <= range.to && b.end_date > range.to).length;
  const tiles: Tile[] = [
    { key: "care", label: "Dogs in care", value: String(inCareNow), sub: `${now.started} started, ${now.cancelled} cancelled`, delta: delta(now.started, prev.started), good: "up", how: "Dogs in care on the last day of the range. Started and cancelled are counted inside the range.", spark: careSpark, to: "/a/dogs" },
    { key: "update", label: "Daily updates", value: now.careDays ? `${pct(now.postCount, now.careDays)}%` : "–", sub: `${now.postCount} of ${now.careDays} dog-days had a post`, delta: delta(pct(now.postCount, now.careDays), pct(prev.postCount, prev.careDays)), good: "up", n: `${now.careDays} dog-days`, how: "Days a dog was in care (since the Oct 23 cutover) on which its trainer posted in the chat, over all such days. Quiet (Signal) chats left out.", spark: postSpark, to: "/a/chats" },
    { key: "reply", label: "Trainer reply time", value: now.replyMedian == null ? "–" : label(now.replyMedian), sub: now.replyN ? `median of ${now.replyN}; 90% within ${label(now.replyP90!)}` : "no client messages answered by trainers", delta: delta(now.replyMedian, prev.replyMedian, true), good: "down", n: `${now.replyN} replies`, how: "From a client's first unanswered message to the trainer's reply, 8 AM–8 PM Eastern only. Median, not average. Replies by the office are in the team figure instead.", spark: [], to: "/a/chats" },
    { key: "team", label: "Team reply time", value: now.teamMedian == null ? "–" : label(now.teamMedian), sub: now.teamN ? `median of ${now.teamN} replies by anyone at Dogwise` : "no replies", delta: delta(now.teamMedian, prev.teamMedian, true), good: "down", n: `${now.teamN} replies`, how: "Same as trainer reply time, but whoever at Dogwise replied first (trainer or office).", spark: [], to: "/a/chats" },
    { key: "forms", label: "Forms on time", value: now.formsN ? `${pct(now.formsOk, now.formsN)}%` : "–", sub: `${now.formsOk} of ${now.formsN} sent by the deadline`, delta: delta(pct(now.formsOk, now.formsN), pct(prev.formsOk, prev.formsN)), good: "up", n: `${now.formsN} forms`, how: "Intake forms, weekly checks and handover reports sent in during the range, on or before their deadline. Forms due before the cutover left out.", spark: [], to: "/a#todo-week" },
    { key: "waiting", label: "Clients left waiting", value: String(now.waiting), sub: `${now.silent} days with no update flagged`, delta: delta(now.waiting, prev.waiting), good: "down", how: "\"Client waiting\" and \"several messages\" alerts raised in the range (unanswered for 3 waking hours, or 3+ messages). Quiet chats left out.", spark: waitSpark, to: "/a#todo-now" }
  ];

  // ── Trainers ──
  const slipRows = ((slips || []) as unknown as { trainer_id: string; total: number; status: string; pay_runs: { period_start: string; period_end: string } | null }[])
    .filter((s) => s.pay_runs && s.pay_runs.period_end >= range.from && s.pay_runs.period_end <= range.to);
  const offRows = (offs || []) as { trainer_id: string; start_date: string; end_date: string }[];
  const trainers: TrainerRow[] = [...now.perTrainer.entries()].map(([id, x]) => {
    const tr = trainerRows.find((t) => t.id === id), cap = Number(tr?.capacity || 0);
    const daysOff = offRows.filter((o) => o.trainer_id === id).reduce((n, o) => n + overlapDays(o.start_date, o.end_date, range.from, range.to), 0);
    const allCare = live.filter((b) => b.trainer_id === id).reduce((n, b) => n + overlapDays(b.start_date, addDays(b.end_date, -1), range.from, range.to), 0); // every dog, quiet or not: kennels are kennels
    return { id, name: trainerName(id), dogs: x.dogs.size, careDays: x.care, postDays: x.post, updateRate: x.care ? Math.round((x.post / x.care) * 100) : null, updateLow: wilsonLower(x.post, x.care),
      replyMedian: median(x.replies), replyN: x.replies.length, formsOnTime: x.formsN ? Math.round((x.formsOk / x.formsN) * 100) : null, formsN: x.formsN, alerts: x.alerts,
      pay: slipRows.filter((s) => s.trainer_id === id).reduce((n, s) => n + Number(s.total || 0), 0), weeks: Math.max(1, Math.round(x.care / 7)), rank: null,
      utilisation: cap ? Math.min(100, Math.round((allCare / (cap * range.days)) * 100)) : null, daysOff, capacity: cap };
  }).sort((a, b) => b.updateLow - a.updateLow || (a.replyMedian ?? 1e9) - (b.replyMedian ?? 1e9));
  let r = 0; for (const t of trainers) t.rank = t.careDays >= 7 ? ++r : null;

  // ── Office view: clients and the link to trainers ──
  let office: OfficeView | null = null;
  if (view === "office") {
    const careNow = live.filter((b) => b.start_date <= range.to && b.end_date > range.to);
    const chatsNow = careNow.map(chatOf).filter((c): c is ChatRow => !!c && !quiet.has(c.id));
    const { data: reads } = chatsNow.length ? await sb.from("chat_reads").select("chat_id, user_id").in("chat_id", chatsNow.map((c) => c.id)) : { data: [] };
    const seen = new Set(((reads || []) as { chat_id: string; user_id: string }[]).filter((r) => chatsNow.some((c) => c.id === r.chat_id && c.client_user_id === r.user_id)).map((r) => r.chat_id));
    const nowMs = Date.now(), silent24: OfficeView["silent24"] = [];
    for (const b of careNow) {
      const c = chatOf(b); if (!c || quiet.has(c.id)) continue;
      const staff = (byChat.get(c.id) || []).filter((m) => m.role === "trainer" || m.role === "admin").map((m) => Date.parse(m.at));
      const last = staff.length ? Math.max(...staff) : Date.parse(`${b.start_date}T12:00:00Z`);
      const hours = Math.round((nowMs - last) / 3600000);
      if (hours >= 24) silent24.push({ dog: b.dog_name || "Dog", client: b.client_name, trainer: b.trainers?.name || "", hours, href: `/a/chats/${c.id}` });
    }
    silent24.sort((a, b) => b.hours - a.hours);
    const waitByChat = new Map<string, number>();
    for (const i of now.inc) if ((i.kind === "client_waiting" || i.kind === "client_pileup") && i.chat_id) waitByChat.set(i.chat_id, (waitByChat.get(i.chat_id) || 0) + 1);
    const waitingClients = [...waitByChat.entries()].filter(([, n]) => n >= 2).map(([id, n]) => { const c = chatList.find((x) => x.id === id); return { client: c?.client_name || "Client", dog: c?.title || "", n, href: `/a/chats/${id}` }; }).sort((a, b) => b.n - a.n);
    const slowTrainers = trainers.filter((t) => t.alerts >= 3).map((t) => ({ name: t.name, alerts: t.alerts, href: `/a/trainers/${t.id}` })).sort((a, b) => b.alerts - a.alerts);
    const nb = new Map<string, number>();
    for (const b of bookings.filter((b) => dayET(b.created_at) >= range.from && dayET(b.created_at) <= range.to)) nb.set(b.trainer_id, (nb.get(b.trainer_id) || 0) + 1);
    const newBookings = [...nb.entries()].map(([id, n]) => ({ name: trainerName(id), n })).sort((a, b) => b.n - a.n);
    const cancellations = bookings.filter((b) => b.status === "cancelled" && b.cancelled_at && dayET(b.cancelled_at) >= range.from && dayET(b.cancelled_at) <= range.to)
      .map((b) => ({ dog: b.dog_name || "Dog", client: b.client_name, trainer: b.trainers?.name || "", reason: `${b.cancel_reason || "No reason recorded"}${b.cancel_note ? `: ${b.cancel_note}` : ""}`, when: dayET(b.cancelled_at!) })).sort((a, b) => b.when.localeCompare(a.when));
    const trainerReports = now.inc.filter((i) => i.kind === "trainer_report").map((i) => ({ title: i.title || "Incident", when: dayET(i.opened_at), detail: (i.detail || "").slice(0, 160) })).sort((a, b) => b.when.localeCompare(a.when));
    let counts = { todo: 0, now: 0, toReview: 0, late: 0, notBooked: 0, notSignedIn: 0 }, lateForms: OfficeView["lateForms"] = [], balances: OfficeView["balances"] = [];
    try {
      const t = await buildTodo();
      const signin = t.items.find((i) => i.key === "signin");
      counts = { todo: t.items.length + (t.late.length ? 1 : 0) + (t.beforeApp.length ? 1 : 0), now: t.items.filter((i) => i.group === "now").length, toReview: t.items.filter((i) => i.key.startsWith("rep:")).length,
        late: t.late.length, notBooked: t.items.filter((i) => /closed won/i.test(i.text)).length, notSignedIn: signin ? Number((signin.text.match(/^(\d+)/) || [])[1] || 0) : 0 };
      const lf = new Map<string, number>();
      for (const x of t.late) lf.set(x.trainerName || "Trainer", (lf.get(x.trainerName || "Trainer") || 0) + 1);
      lateForms = [...lf.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
      balances = t.items.filter((i) => /balance/i.test(i.detail || "") && /ready|start/i.test(i.text)).map((i) => ({ text: i.text, href: i.dogHref || i.primary?.href }));
    } catch (e) { notes.push(`To do: ${(e as Error).message}`); }
    office = { joined: seen.size, chats: chatsNow.length, silent24, waitingClients, slowTrainers, newBookings,
      dateChanges: now.inc.filter((i) => i.kind === "length_changed").length, overbooked: now.inc.filter((i) => i.kind === "overbooked").length,
      cancellations, lateForms, balances, incidents: trainerReports, counts };
  }

  // ── Sales view (RevOps) ──
  let sales: SalesView | null = null;
  if (view === "sales" && hubspotConfigured()) {
    try {
      const lyFrom = addDays(range.from, -365), lyTo = addDays(range.to, -365);
      // Next calendar month after the range, one year ago: what last year says to expect
      const [ty, tm] = range.to.split("-").map(Number), nmY = (tm === 12 ? ty + 1 : ty) - 1, nmM = tm === 12 ? 1 : tm + 1;
      const nmFrom = `${nmY}-${String(nmM).padStart(2, "0")}-01`, nmTo = addDays(nmM === 12 ? `${nmY + 1}-01-01` : `${nmY}-${String(nmM + 1).padStart(2, "0")}-01`, -1);
      const nmLabel = new Date(`${nmFrom}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
      const [created, wonNow, lostRows, leadsLY, wonLY, wonNM, people] = await Promise.all([
        dealsCreatedBetween(range.from, range.to, 20), closedWonBetween(range.from, range.to, 5), lostDealsBetween(range.from, range.to),
        countObjects("deals", [{ propertyName: "createdate", operator: "GTE", value: String(etMidnight(lyFrom)) }, { propertyName: "createdate", operator: "LT", value: String(etMidnight(addDays(lyTo, 1))) }]).catch(() => null),
        closedWonBetween(lyFrom, lyTo, 5).catch(() => null), closedWonBetween(nmFrom, nmTo, 5).catch(() => null), salesPeople().catch(() => [])
      ]);
      points += created.rows.length + wonNow.rows.length + lostRows.length + (wonLY?.rows.length || 0) + (wonNM?.rows.length || 0);
      const won = wonNow.rows, cells = new Map<string, StateCell>();
      const cell = (st: string) => { if (!cells.has(st)) cells.set(st, { st, created: 0, won: 0, wonAmount: 0, credits: 0, coverageLost: 0 }); return cells.get(st)!; };
      const bySource = new Map<string, { created: number; won: number; credits: number }>();
      const src = (p: Record<string, string | null>) => (p.lead_source || p.deal_source || "Unknown").trim() || "Unknown";
      // Costs: only deals that carry Bark credits count. No guessing.
      let creditSum = 0, creditLeads = 0;
      for (const d of created.rows) {
        const p = d.properties, st = stateOf(p.dealname), cr = Number(p.bark_credits_paid || 0);
        if (cr > 0) { creditSum += cr; creditLeads++; }
        if (st) { const x = cell(st); x.created++; x.credits += cr; }
        const k = src(p), b = bySource.get(k) || { created: 0, won: 0, credits: 0 }; b.created++; b.credits += cr; bySource.set(k, b);
      }
      let wonWithCredits = 0; const closeDaysArr: number[] = [];
      for (const d of won) {
        const p = d.properties, st = stateOf(p.dealname), amt = Number(p.amount || 0);
        if (Number(p.bark_credits_paid || 0) > 0) wonWithCredits++;
        if (st) { const x = cell(st); x.won++; x.wonAmount += amt; }
        const k = src(p), b = bySource.get(k) || { created: 0, won: 0, credits: 0 }; b.won++; bySource.set(k, b);
        if (p.createdate && p.closedate) closeDaysArr.push(Math.max(0, Math.round((Date.parse(p.closedate) - Date.parse(p.createdate)) / 86400000)));
      }
      let planLost = { n: 0, amount: 0 };
      for (const d of lostRows) {
        const p = d.properties, st = stateOf(p.dealname), why = p.closed_lost_reason_new || "";
        if (/payment plan/i.test(why)) { planLost.n++; planLost.amount += Number(p.amount || 0); }
        if (st && (/local/i.test(why) || p.dealstage === "173376666" || p.trainer_in_range === "false")) cell(st).coverageLost++;
      }
      const creditUsd = Number(process.env.BARK_CREDIT_USD || 0) || null;
      const fmt = (n: number) => (creditUsd ? money(n * creditUsd) : `${Math.round(n * 10) / 10} cr`);
      // Salespeople: leads assigned, won (from the app's deal copy), and work done (calls and emails logged in HubSpot)
      const wonByOwner = new Map<string, { n: number; amount: number }>();
      for (const d of ((deals || []) as { amount: number; closed_on: string; owner_id: string | null }[]).filter((d) => d.closed_on >= range.from && d.closed_on <= range.to)) {
        const k = d.owner_id || "none", x = wonByOwner.get(k) || { n: 0, amount: 0 }; x.n++; x.amount += Number(d.amount || 0); wonByOwner.set(k, x);
      }
      const ms = { from: String(etMidnight(range.from)), to: String(etMidnight(addDays(range.to, 1))) };
      const peopleRows: SalesPerson[] = await Promise.all(people.map(async (o) => {
        const [leads, calls, emails] = await Promise.all([
          countObjects("deals", [{ propertyName: "createdate", operator: "GTE", value: String(etMidnight(range.from)) }, { propertyName: "createdate", operator: "LT", value: ms.to }, { propertyName: "hubspot_owner_id", operator: "EQ", value: o.id }]).catch(() => 0),
          countObjects("calls", [{ propertyName: "hs_timestamp", operator: "GTE", value: ms.from }, { propertyName: "hs_timestamp", operator: "LT", value: ms.to }, { propertyName: "hubspot_owner_id", operator: "EQ", value: o.id }]).catch(() => 0),
          countObjects("emails", [{ propertyName: "hs_timestamp", operator: "GTE", value: ms.from }, { propertyName: "hs_timestamp", operator: "LT", value: ms.to }, { propertyName: "hubspot_owner_id", operator: "EQ", value: o.id }, { propertyName: "hs_email_direction", operator: "EQ", value: "EMAIL" }]).catch(() => 0)
        ]);
        const w = wonByOwner.get(o.id) || { n: 0, amount: 0 };
        return { name: o.name, leads, won: w.n, amount: w.amount, calls, emails };
      }));
      let failed: SalesView["failed"] = null;
      if (stripeConfigured()) { try { failed = await failedCharges(Math.floor(etMidnight(range.from) / 1000), Math.floor(etMidnight(addDays(range.to, 1)) / 1000)); } catch (e) { notes.push(`Stripe: ${(e as Error).message}`); } }
      sales = {
        leads: created.total, leadsLastYear: leadsLY, won: won.length, wonAmount: won.reduce((n, d) => n + Number(d.properties.amount || 0), 0),
        wonLastYear: wonLY ? { n: wonLY.total, amount: wonLY.rows.reduce((n, d) => n + Number(d.properties.amount || 0), 0) } : null,
        conversion: created.total ? Math.round((won.length / created.total) * 1000) / 10 : null,
        perLead: creditLeads ? fmt(creditSum / creditLeads) : "–", perLeadN: creditLeads, perSale: wonWithCredits ? fmt(creditSum / wonWithCredits) : "–", perSaleN: wonWithCredits, creditUsd,
        closeDays: median(closeDaysArr), closeN: closeDaysArr.length,
        nextMonth: wonNM ? { label: nmLabel, n: wonNM.total, amount: wonNM.rows.reduce((n, d) => n + Number(d.properties.amount || 0), 0) } : null,
        bySource: [...bySource.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.created - a.created).slice(0, 8),
        states: [...cells.values()], people: peopleRows.filter((p) => p.leads || p.won || p.calls || p.emails).sort((a, b) => b.amount - a.amount || b.won - a.won),
        planLost, failed, mapCapped: created.capped
      };
      if (created.capped) notes.push(`The map and sources use the first ${created.rows.length} of ${created.total} deals created in this range (HubSpot is paged); the lead count itself is complete.`);
      if (!creditUsd) notes.push("Costs are in Bark credits until BARK_CREDIT_USD is set in Vercel.");
    } catch (e) { notes.push(`Sales: HubSpot didn't answer (${(e as Error).message}).`); }
  } else if (view === "sales") notes.push("Sales needs HubSpot (not set up here).");

  // ── Decision cards ──
  const cards: Card[] = [];
  if (view !== "sales") {
    for (const t of trainers.filter((t) => t.dogs >= 2 && t.careDays >= 7 && (t.updateRate ?? 100) < 60).slice(0, 2)) cards.push({ tone: "heart", title: `${t.name}: updates on ${t.updateRate}% of days with ${t.dogs} dogs`, evidence: `${t.postDays} of ${t.careDays} dog-days had a post. Clients were promised one a day.`, href: `/a/trainers/${t.id}`, action: "Open trainer" });
    if (now.waiting >= 5) cards.push({ tone: "heart", title: `${now.waiting} clients left waiting`, evidence: `Team reply median ${now.teamMedian == null ? "–" : label(now.teamMedian)}. Each is a client unanswered for 3+ waking hours.`, href: "/a#todo-now", action: "See To do" });
    if (now.started && now.cancelled / Math.max(1, now.started) > 0.15) cards.push({ tone: "heart", title: `${now.cancelled} cancelled against ${now.started} started`, evidence: "More than 15% cancelled in this range. Reasons are on the bookings.", href: "/a/dogs", action: "See bookings" });
    if (now.formsN >= 10 && pct(now.formsOk, now.formsN)! < 70) cards.push({ tone: "biscuit", title: `Forms on time: ${pct(now.formsOk, now.formsN)}%`, evidence: `${now.formsN - now.formsOk} of ${now.formsN} forms were late.`, href: "/a#todo-week", action: "See late forms" });
  } else if (sales) {
    if (sales.planLost.n >= 2) cards.push({ tone: "biscuit", title: `${sales.planLost.n} people weren't approved for a payment plan (${money(sales.planLost.amount)})`, evidence: "Try splitting the cost into two smaller plans before these go cold." });
    if (sales.failed && sales.failed.n >= 2) cards.push({ tone: "heart", title: `${sales.failed.n} card payments failed (${money(sales.failed.amount)})`, evidence: "From Stripe. Worth a call before the next attempt fails too.", href: "/a/sales", action: "Open sales" });
    const cov = sales.states.reduce((n, s) => n + s.coverageLost, 0);
    if (cov >= 3) cards.push({ tone: "biscuit", title: `${cov} deals lost for lack of a nearby trainer`, evidence: `Where: ${sales.states.filter((s) => s.coverageLost).sort((a, b) => b.coverageLost - a.coverageLost).slice(0, 4).map((s) => `${s.st} (${s.coverageLost})`).join(", ")}.`, action: "Recruit there" });
    if (sales.wonLastYear && sales.wonLastYear.n && sales.won < sales.wonLastYear.n * 0.7) cards.push({ tone: "heart", title: `Sales are ${Math.round((1 - sales.won / sales.wonLastYear.n) * 100)}% below the same range last year`, evidence: `${sales.won} now against ${sales.wonLastYear.n} then.` });
  }
  if (!cards.length) cards.push({ tone: "mint", title: "Nothing needs a decision in this range", evidence: "Everything is inside its usual bands." });

  return { range, view, tiles, cards: cards.slice(0, 5), trainers, office, sales, notes, stats: { points, ms: Date.now() - t0, at: new Date().toISOString() } };
}

/** The same, kept for 5 minutes per range and view (Refresh on the page drops it). */
export const pulseCached = unstable_cache(async (q: { r?: string; from?: string; to?: string; v?: string }) => pulse(q), ["pulse-v3"], { revalidate: 300, tags: ["pulse"] });
