import "server-only";
import { serviceClient, isDemo } from "./supabase";
import { addDays, daysBetween, todayIso } from "./dates";
import { FORMS_CUTOVER } from "./reports";
import { closedWonSince, dealsCreatedBetween, hubspotConfigured, lostDealsBetween } from "./hubspot";
import { stateOf } from "./usTiles";
import { buildTodo } from "./todo";
import { dayET, delta, median, percentile, replyRuns, wilsonLower } from "./pulseMath";

// Pulse: the dashboard's numbers for a date range (and the period before it, for comparison). Preview for Alma.
// Everything is worked out from the app's own tables plus the closed deals copy (deal_money); lost deals come from HubSpot live.
// Rules: quiet (Signal) chats and days before the Oct 23 cutover don't count against anyone. Times are waking hours, Eastern.

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

type BookingRow = { id: string; trainer_id: string; hubspot_deal_id: string | null; dog_name: string | null; client_name: string; start_date: string; end_date: string; status: string; created_at: string; cancelled_at?: string | null; cancel_reason?: string | null; program: string | null; trainers: { name: string } | null };
type ChatRow = { id: string; deal_key: string; trainer_id: string | null; quiet_at?: string | null; client_user_id: string | null; client_name: string | null; title: string | null; status: string };
type MsgRow = { chat_id: string; sender_role: string; kind: string; created_at: string };

export type Tile = { key: string; label: string; value: string; sub: string; delta: { text: string; up: boolean | null }; good?: "up" | "down"; n?: string; how: string; spark: number[] };
export type Card = { tone: "heart" | "biscuit" | "mint"; title: string; evidence: string; href?: string; action?: string };
export type TrainerRow = {
  id: string; name: string; dogs: number; careDays: number; postDays: number; updateRate: number | null; updateLow: number; replyMedian: number | null; replyN: number;
  formsOnTime: number | null; formsN: number; alerts: number; pay: number; weeks: number; rank: number | null;
};
export type View = "clients" | "trainers" | "sales" | "office";
export type StateCell = { st: string; created: number; won: number; wonAmount: number; credits: number; coverageLost: number };
export type SalesView = {
  created: number; createdTotal: number; capped: boolean; won: number; wonAmount: number; credits: number; creditCost: number | null;
  perLead: string; perSale: string; closeDays: number | null; closeN: number;
  bySource: { source: string; created: number; won: number; credits: number }[];
  states: StateCell[]; wonList: { name: string; amount: number; closedOn: string; st: string | null }[];
};
export type ClientsView = { chats: number; joined: number; silent24: { dog: string; client: string; trainer: string; hours: number; href: string }[] };
export type OfficeView = { todo: number; now: number; toReview: number; lateForms: number; notBooked: number; notSignedIn: number; items: { text: string; href?: string; group: string }[] };
export type Pulse = {
  range: Range; view: View; tiles: Tile[]; cards: Card[]; trainers: TrainerRow[];
  lost: { total: number; amount: number; coverage: number; coverageAmount: number; reasons: { reason: string; n: number; amount: number }[]; regions: { region: string; n: number }[] } | null;
  sales: SalesView | null; clients: ClientsView | null; office: OfficeView | null; notes: string[];
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (k: number, n: number) => (n ? Math.round((k / n) * 100) : null);
/** Days of a booking inside [from, to], up to today, and not before the cutover (the app's "daily update" promise starts there). */
function careDaysIn(b: { start_date: string; end_date: string }, from: string, to: string): string[] {
  const lo = [b.start_date, from, FORMS_CUTOVER].sort().pop()!, hi = [addDays(b.end_date, -1), to, todayIso()].sort()[0];
  const out: string[] = [];
  for (let d = lo; d <= hi; d = addDays(d, 1)) out.push(d);
  return out;
}

export async function pulse(q: { r?: string; from?: string; to?: string; v?: string; state?: string }): Promise<Pulse> {
  const range = pulseRange(q), notes: string[] = [];
  const view: View = (["clients", "trainers", "sales", "office"] as View[]).find((x) => x === q.v) || "clients";
  const empty: Pulse = { range, view, tiles: [], cards: [], trainers: [], lost: null, sales: null, clients: null, office: null, notes: ["Demo mode: no data."] };
  if (isDemo()) return empty;
  const sb = serviceClient();
  const sparkFrom = addDays(range.to, -89); // 90-day sparklines
  const loadFrom = [range.prevFrom, sparkFrom].sort()[0];

  const [{ data: bks }, { data: chats }, { data: msgs }, { data: incs }, { data: reps }, { data: slips }, { data: deals }] = await Promise.all([
    sb.from("bookings").select("id, trainer_id, hubspot_deal_id, dog_name, client_name, start_date, end_date, status, created_at, cancelled_at, cancel_reason, program, trainers(name)").lte("start_date", range.to).gte("end_date", loadFrom),
    sb.from("chats").select("id, deal_key, trainer_id, quiet_at, client_user_id, client_name, title, status"),
    sb.from("chat_messages").select("chat_id, sender_role, kind, created_at").gte("created_at", `${loadFrom}T00:00:00Z`).lte("created_at", `${addDays(range.to, 1)}T12:00:00Z`).in("kind", ["text", "media"]).limit(20000),
    sb.from("chat_incidents").select("chat_id, kind, opened_at, resolved_at, status").gte("opened_at", `${loadFrom}T00:00:00Z`),
    sb.from("reports").select("trainer_id, kind, due_by, submitted_at, status").gte("submitted_at", `${range.prevFrom}T00:00:00Z`).lte("submitted_at", `${addDays(range.to, 1)}T12:00:00Z`),
    sb.from("payslips").select("trainer_id, total, status, pay_runs(period_start, period_end)"),
    sb.from("deal_money").select("deal_id, amount, closed_on, owner_id").gte("closed_on", range.prevFrom).lte("closed_on", range.to)
  ]);
  const bookings = ((bks || []) as unknown as BookingRow[]);
  const live = bookings.filter((b) => b.status !== "cancelled");
  const chatList = (chats || []) as ChatRow[];
  const chatByDeal = new Map(chatList.map((c) => [c.deal_key, c]));
  const chatOf = (b: BookingRow) => chatByDeal.get(b.hubspot_deal_id || "") || chatByDeal.get(b.id) || null;
  const messages = (msgs || []) as MsgRow[];
  const quiet = new Set(chatList.filter((c) => c.quiet_at).map((c) => c.id));

  // ── Posts per chat per Eastern day (trainer updates), and reply runs per chat ──
  const postDays = new Map<string, Set<string>>(), byChat = new Map<string, { role: string; at: string }[]>();
  for (const m of messages) {
    if (m.sender_role === "trainer") { if (!postDays.has(m.chat_id)) postDays.set(m.chat_id, new Set()); postDays.get(m.chat_id)!.add(dayET(m.created_at)); }
    if (!byChat.has(m.chat_id)) byChat.set(m.chat_id, []);
    byChat.get(m.chat_id)!.push({ role: m.sender_role, at: m.created_at });
  }

  // ── Per period: care days, update days, replies, forms, cancellations, sales ──
  const period = (from: string, to: string) => {
    const inCare = live.filter((b) => b.start_date <= to && b.end_date > from);
    let careDays = 0, postCount = 0;
    const perTrainer = new Map<string, { dogs: Set<string>; care: number; post: number; replies: number[]; formsOk: number; formsN: number; alerts: number }>();
    const t = (id: string) => { if (!perTrainer.has(id)) perTrainer.set(id, { dogs: new Set(), care: 0, post: 0, replies: [], formsOk: 0, formsN: 0, alerts: 0 }); return perTrainer.get(id)!; };
    for (const b of inCare) {
      const c = chatOf(b);
      if (!c || quiet.has(c.id)) continue;            // no chat, or finishing on Signal: not counted against anyone
      const days = careDaysIn(b, from, to), posted = postDays.get(c.id) || new Set<string>();
      const hit = days.filter((d) => posted.has(d)).length;
      careDays += days.length; postCount += hit;
      const x = t(b.trainer_id); x.dogs.add(b.id); x.care += days.length; x.post += hit;
    }
    const replies: number[] = [], team: number[] = [];
    for (const c of chatList) {
      if (quiet.has(c.id)) continue;
      for (const r of replyRuns(byChat.get(c.id) || [])) {
        if (r.askedAt < `${from}T00:00:00Z` || r.askedAt > `${addDays(to, 1)}T04:00:00Z` || dayET(r.askedAt) < from || dayET(r.askedAt) > to) continue;
        team.push(r.minutes);
        if (r.by === "trainer" && c.trainer_id) { replies.push(r.minutes); t(c.trainer_id).replies.push(r.minutes); }
      }
    }
    let formsOk = 0, formsN = 0;
    for (const r of (reps || []) as { trainer_id: string; due_by: string | null; submitted_at: string | null; status: string }[]) {
      if (!r.submitted_at || !r.due_by) continue;
      const d = dayET(r.submitted_at); if (d < from || d > to) continue;
      if (dayET(r.due_by) < FORMS_CUTOVER) continue;
      formsN++; const ok = r.submitted_at <= r.due_by; if (ok) formsOk++;
      const x = t(r.trainer_id); x.formsN++; if (ok) x.formsOk++;
    }
    const incidents = ((incs || []) as { chat_id: string; kind: string; opened_at: string; status: string }[]).filter((i) => { const d = dayET(i.opened_at); return d >= from && d <= to && !quiet.has(i.chat_id); });
    const waiting = incidents.filter((i) => i.kind === "client_waiting" || i.kind === "client_pileup").length, silent = incidents.filter((i) => i.kind === "trainer_silent").length;
    for (const i of incidents) { const c = chatList.find((x) => x.id === i.chat_id); if (c?.trainer_id && ["client_waiting", "client_pileup", "trainer_silent"].includes(i.kind)) t(c.trainer_id).alerts++; }
    const started = live.filter((b) => b.start_date >= from && b.start_date <= to).length;
    const cancelled = bookings.filter((b) => b.status === "cancelled" && b.cancelled_at && dayET(b.cancelled_at) >= from && dayET(b.cancelled_at) <= to).length;
    const sold = ((deals || []) as { amount: number; closed_on: string }[]).filter((d) => d.closed_on >= from && d.closed_on <= to);
    return { inCare: inCare.length, careDays, postCount, replyMedian: median(replies), replyP90: percentile(replies, 90), replyN: replies.length, teamMedian: median(team),
      formsOk, formsN, waiting, silent, started, cancelled, sales: sold.length, revenue: sold.reduce((n, d) => n + Number(d.amount || 0), 0), perTrainer };
  };
  const now = period(range.from, range.to), prev = period(range.prevFrom, range.prevTo);

  // ── Sparklines: per day for the last 90 days ──
  const days90 = Array.from({ length: 90 }, (_, i) => addDays(sparkFrom, i));
  const careSpark = days90.map((d) => live.filter((b) => b.start_date <= d && b.end_date > d).length);
  const postSpark = days90.map((d) => { let n = 0; for (const [, set] of postDays) if (set.has(d)) n++; return n; });
  const waitSpark = days90.map((d) => ((incs || []) as { kind: string; opened_at: string }[]).filter((i) => i.kind === "client_waiting" && dayET(i.opened_at) === d).length);
  const soldSpark = days90.map((d) => ((deals || []) as { closed_on: string }[]).filter((x) => x.closed_on === d).length);

  const inCareNow = live.filter((b) => b.start_date <= range.to && b.end_date > range.to).length;
  const tiles: Tile[] = [
    { key: "care", label: "Dogs in care", value: String(inCareNow), sub: `${now.started} started, ${now.cancelled} cancelled`, delta: delta(now.started, prev.started), good: "up", how: "Dogs in care on the last day of the range. Started and cancelled are counted inside the range.", spark: careSpark },
    { key: "update", label: "Daily updates", value: now.careDays ? `${pct(now.postCount, now.careDays)}%` : "–", sub: `${now.postCount} of ${now.careDays} dog-days had a post`, delta: delta(pct(now.postCount, now.careDays), pct(prev.postCount, prev.careDays)), good: "up", n: `${now.careDays} dog-days`, how: "Days a dog was in care (since the Oct 23 cutover) on which its trainer posted in the chat, divided by all such days. Quiet (Signal) chats are left out.", spark: postSpark },
    { key: "reply", label: "Trainer reply time", value: now.replyMedian == null ? "–" : label(now.replyMedian), sub: now.replyN ? `median of ${now.replyN}; 90% within ${label(now.replyP90!)}` : "no client messages answered by trainers", delta: delta(now.replyMedian, prev.replyMedian, true), good: "down", n: `${now.replyN} replies`, how: "From a client's first unanswered message to the trainer's reply, counting 8 AM–8 PM Eastern only. Median, not average. Replies by the office don't count here.", spark: [] },
    { key: "forms", label: "Forms on time", value: now.formsN ? `${pct(now.formsOk, now.formsN)}%` : "–", sub: `${now.formsOk} of ${now.formsN} sent by the deadline`, delta: delta(pct(now.formsOk, now.formsN), pct(prev.formsOk, prev.formsN)), good: "up", n: `${now.formsN} forms`, how: "Intake forms, weekly checks and handover reports sent in during the range, on or before their deadline. Forms due before the cutover are left out.", spark: [] },
    { key: "waiting", label: "Clients left waiting", value: String(now.waiting), sub: `${now.silent} days with no update flagged`, delta: delta(now.waiting, prev.waiting), good: "down", how: "\"Client waiting\" and \"several messages\" alerts raised in the range (a client unanswered for 3 waking hours, or 3+ messages). Quiet chats left out.", spark: waitSpark },
    { key: "sales", label: "Sold", value: money(now.revenue), sub: `${now.sales} deal${now.sales === 1 ? "" : "s"} closed won`, delta: delta(now.revenue, prev.revenue, true), good: "up", how: "Closed Won deals by close date, from the app's copy of HubSpot (deal_money). Amount is the program price before refunds.", spark: soldSpark }
  ];

  // ── Trainers ──
  const trainerNames = new Map(bookings.map((b) => [b.trainer_id, b.trainers?.name || "Trainer"]));
  const slipRows = ((slips || []) as unknown as { trainer_id: string; total: number; status: string; pay_runs: { period_start: string; period_end: string } | null }[])
    .filter((s) => s.pay_runs && s.pay_runs.period_end >= range.from && s.pay_runs.period_end <= range.to);
  const groupRate = now.careDays ? now.postCount / now.careDays : 0;
  const trainers: TrainerRow[] = [...now.perTrainer.entries()].map(([id, x]) => {
    const weeks = Math.max(1, Math.round(x.care / 7));
    return { id, name: trainerNames.get(id) || "Trainer", dogs: x.dogs.size, careDays: x.care, postDays: x.post, updateRate: x.care ? Math.round((x.post / x.care) * 100) : null, updateLow: wilsonLower(x.post, x.care),
      replyMedian: median(x.replies), replyN: x.replies.length, formsOnTime: x.formsN ? Math.round((x.formsOk / x.formsN) * 100) : null, formsN: x.formsN, alerts: x.alerts,
      pay: slipRows.filter((s) => s.trainer_id === id).reduce((n, s) => n + Number(s.total || 0), 0), weeks, rank: null };
  }).sort((a, b) => b.updateLow - a.updateLow || (a.replyMedian ?? 1e9) - (b.replyMedian ?? 1e9));
  let r = 0; for (const t of trainers) t.rank = t.careDays >= 7 ? ++r : null; // fewer than a week of data: no rank
  void groupRate;

  // ── Lost deals (HubSpot live) ──
  let lost: Pulse["lost"] = null, lostRows: { id: string; properties: Record<string, string | null> }[] = [];
  if (hubspotConfigured()) {
    try {
      const rows = await lostDealsBetween(range.from, range.to); lostRows = rows;
      const reasons = new Map<string, { n: number; amount: number }>(), regions = new Map<string, number>();
      let coverage = 0, coverageAmount = 0;
      for (const d of rows) {
        const p = d.properties, why = p.closed_lost_reason_new || (p.dealstage === "173376666" || p.dealstage === "142034212" ? "No trainers available" : "No reason given"), amt = Number(p.amount || 0);
        const x = reasons.get(why) || { n: 0, amount: 0 }; x.n++; x.amount += amt; reasons.set(why, x);
        const noCover = /local/i.test(why) || /No trainers/i.test(why) || p.trainer_in_range === "false";
        if (noCover) { coverage++; coverageAmount += amt; const m = String(p.dealname || "").match(/,\s*([A-Za-z .]+),\s*([A-Z]{2})\b/); const region = m ? `${m[1].trim()}, ${m[2]}` : "Unknown"; regions.set(region, (regions.get(region) || 0) + 1); }
      }
      lost = { total: rows.length, amount: rows.reduce((n, d) => n + Number(d.properties.amount || 0), 0), coverage, coverageAmount,
        reasons: [...reasons.entries()].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.n - a.n).slice(0, 6),
        regions: [...regions.entries()].map(([region, n]) => ({ region, n })).sort((a, b) => b.n - a.n).slice(0, 5) };
    } catch (e) { notes.push(`Lost deals: HubSpot didn't answer (${(e as Error).message}).`); }
  } else notes.push("Lost deals need HubSpot (not set up here).");

  // ── Decision cards ──
  const cards: Card[] = [];
  const weak = trainers.filter((t) => t.dogs >= 2 && t.careDays >= 7 && (t.updateRate ?? 100) < 60);
  for (const t of weak.slice(0, 2)) cards.push({ tone: "heart", title: `${t.name}: updates on ${t.updateRate}% of days with ${t.dogs} dogs`, evidence: `${t.postDays} of ${t.careDays} dog-days had a post in this range. Clients were promised one a day.`, href: `/a/trainers/${t.id}`, action: "Open trainer" });
  if (now.waiting >= 5) cards.push({ tone: "heart", title: `${now.waiting} clients left waiting`, evidence: `Team reply median ${label(now.teamMedian ?? 0)} this range. Each one is a client who waited 3+ waking hours.`, href: "/a#todo-now", action: "See To do" });
  if (lost && lost.coverage >= 3) cards.push({ tone: "biscuit", title: `${lost.coverage} deals lost for lack of a nearby trainer (${money(lost.coverageAmount)})`, evidence: `Top areas: ${lost.regions.slice(0, 3).map((x) => `${x.region} (${x.n})`).join(", ")}. That's revenue you can't take without recruiting there.`, action: "Recruit" });
  if (lost) { const price = lost.reasons.find((x) => /price/i.test(x.reason)); if (price && price.n >= 3) cards.push({ tone: "biscuit", title: `${price.n} deals lost on price (${money(price.amount)})`, evidence: "Worth testing a payment plan or a smaller program on these before they go cold.", action: "Review pricing" }); }
  if (now.started && now.cancelled / Math.max(1, now.started) > 0.15) cards.push({ tone: "heart", title: `${now.cancelled} cancelled against ${now.started} started`, evidence: "More than 15% cancelled in this range. Reasons are on each cancelled booking.", href: "/a/dogs", action: "See bookings" });
  if (now.formsN >= 10 && pct(now.formsOk, now.formsN)! < 70) cards.push({ tone: "biscuit", title: `Forms on time: ${pct(now.formsOk, now.formsN)}%`, evidence: `${now.formsN - now.formsOk} of ${now.formsN} forms were late in this range.`, href: "/a#todo-week", action: "See late forms" });
  if (!cards.length) cards.push({ tone: "mint", title: "Nothing needs a decision in this range", evidence: "Updates, replies, forms and cancellations are all inside their usual bands." });

  // ── Clients view: joined the app, and dogs in care with no word from Dogwise for 24 h+ ──
  let clientsView: ClientsView | null = null;
  if (view === "clients") {
    const careNow = live.filter((b) => b.start_date <= range.to && b.end_date > range.to);
    const chatsNow = careNow.map(chatOf).filter((c): c is ChatRow => !!c && !quiet.has(c.id));
    const { data: reads } = chatsNow.length ? await sb.from("chat_reads").select("chat_id, user_id").in("chat_id", chatsNow.map((c) => c.id)) : { data: [] };
    const seen = new Set(((reads || []) as { chat_id: string; user_id: string }[]).filter((r) => chatsNow.some((c) => c.id === r.chat_id && c.client_user_id === r.user_id)).map((r) => r.chat_id));
    const nowMs = Date.now(), silent24: ClientsView["silent24"] = [];
    for (const b of careNow) {
      const c = chatOf(b); if (!c || quiet.has(c.id)) continue;
      const staff = (byChat.get(c.id) || []).filter((m) => m.role === "trainer" || m.role === "admin").map((m) => Date.parse(m.at));
      const last = staff.length ? Math.max(...staff) : Date.parse(`${b.start_date}T12:00:00Z`);
      const hours = Math.round((nowMs - last) / 3600000);
      if (hours >= 24) silent24.push({ dog: b.dog_name || "Dog", client: b.client_name, trainer: b.trainers?.name || "", hours, href: `/a/chats/${c.id}` });
    }
    silent24.sort((a, b) => b.hours - a.hours);
    clientsView = { chats: chatsNow.length, joined: seen.size, silent24 };
  }

  // ── Sales view (RevOps): where deals come from, where sales come from, what leads cost ──
  let salesView: SalesView | null = null;
  if (view === "sales" && hubspotConfigured()) {
    try {
      const [created, wonRows] = await Promise.all([dealsCreatedBetween(range.from, range.to, 20), closedWonSince(range.from, ["amount", "createdate", "closedate", "dealname", "bark_credits_paid", "lead_source", "deal_source"])]);
      const won = wonRows.filter((d) => { const c = (d.properties.closedate || "").slice(0, 10); return c >= range.from && c <= range.to; });
      const cells = new Map<string, StateCell>();
      const cell = (st: string) => { if (!cells.has(st)) cells.set(st, { st, created: 0, won: 0, wonAmount: 0, credits: 0, coverageLost: 0 }); return cells.get(st)!; };
      const bySource = new Map<string, { created: number; won: number; credits: number }>();
      const src = (p: Record<string, string | null>) => (p.lead_source || p.deal_source || "Unknown").trim() || "Unknown";
      let credits = 0;
      for (const d of created.rows) {
        const p = d.properties, st = stateOf(p.dealname), cr = Number(p.bark_credits_paid || 0);
        credits += cr; if (st) { const x = cell(st); x.created++; x.credits += cr; }
        const k = src(p); const b = bySource.get(k) || { created: 0, won: 0, credits: 0 }; b.created++; b.credits += cr; bySource.set(k, b);
      }
      const wonList: SalesView["wonList"] = [];
      let closeDaysArr: number[] = [];
      for (const d of won) {
        const p = d.properties, st = stateOf(p.dealname), amt = Number(p.amount || 0);
        if (st) { const x = cell(st); x.won++; x.wonAmount += amt; }
        const k = src(p); const b = bySource.get(k) || { created: 0, won: 0, credits: 0 }; b.won++; bySource.set(k, b);
        if (p.createdate && p.closedate) closeDaysArr.push(Math.max(0, Math.round((Date.parse(p.closedate) - Date.parse(p.createdate)) / 86400000)));
        wonList.push({ name: String(p.dealname || "Deal"), amount: amt, closedOn: (p.closedate || "").slice(0, 10), st });
      }
      for (const d of lostRows) { const p = d.properties; const st = stateOf(p.dealname); if (st && (/local/i.test(p.closed_lost_reason_new || "") || p.dealstage === "173376666" || p.trainer_in_range === "false")) cell(st).coverageLost++; }
      const creditUsd = Number(process.env.BARK_CREDIT_USD || 0) || null, wonAmount = won.reduce((n, d) => n + Number(d.properties.amount || 0), 0);
      const fmtCredits = (n: number) => (creditUsd ? money(n * creditUsd) : `${Math.round(n * 10) / 10} credits`);
      salesView = {
        created: created.rows.length, createdTotal: created.total, capped: created.capped, won: won.length, wonAmount, credits, creditCost: creditUsd ? credits * creditUsd : null,
        perLead: created.rows.length ? fmtCredits(credits / created.rows.length) : "–", perSale: won.length ? fmtCredits(credits / won.length) : "–",
        closeDays: median(closeDaysArr), closeN: closeDaysArr.length,
        bySource: [...bySource.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.created - a.created).slice(0, 8),
        states: [...cells.values()], wonList: wonList.sort((a, b) => b.closedOn.localeCompare(a.closedOn))
      };
      if (created.capped) notes.push(`Deals created: the first ${created.rows.length} of ${created.total} in this range (HubSpot is paged; a nightly table will fix this).`);
      if (!creditUsd) notes.push("Bark credits are shown as credits. Set BARK_CREDIT_USD in Vercel to show dollars.");
    } catch (e) { notes.push(`Sales: HubSpot didn't answer (${(e as Error).message}).`); }
  }

  // ── Office view: what's on the team's plate right now ──
  let officeView: OfficeView | null = null;
  if (view === "office") {
    try {
      const t = await buildTodo();
      const now = t.items.filter((i) => i.group === "now").length;
      const toReview = t.items.filter((i) => i.key.startsWith("rep:")).length;
      const notBooked = t.items.filter((i) => /Closed Won|closed won/i.test(i.text)).length;
      const signin = t.items.find((i) => i.key === "signin");
      const notSignedIn = signin ? Number((signin.text.match(/^(\d+)/) || [])[1] || 0) : 0;
      officeView = { todo: t.items.length + (t.late.length ? 1 : 0) + (t.beforeApp.length ? 1 : 0), now, toReview, lateForms: t.late.length, notBooked, notSignedIn,
        items: t.items.filter((i) => i.group === "now").slice(0, 12).map((i) => ({ text: i.text, href: i.primary?.href || i.dogHref, group: i.group })) };
    } catch (e) { notes.push(`Office: ${(e as Error).message}`); }
  }

  return { range, view, tiles, cards: cards.slice(0, 5), trainers, lost, sales: salesView, clients: clientsView, office: officeView, notes };
}

function label(m: number) { return m < 60 ? `${m}m` : m < 720 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${Math.floor(m / 720)}d ${Math.floor((m % 720) / 60) ? `${Math.floor((m % 720) / 60)}h` : ""}`.trim(); }
