import "server-only";
import { unstable_cache } from "next/cache";
import { addDays, daysBetween } from "./dates";
import { closedWonBetween, countObjects, etMidnight, hubspotConfigured, lostDealsBetween } from "./hubspot";
import { salesPeople } from "./sales";
import { chargeOutcomes, stripeConfigured } from "./stripe";
import { dayET, median } from "./pulseMath";

// Sales insights (the Sales screen, admin and sales managers): what happened this month against the same month last year
// and against last month, what last year says about next month, a 13-month strip, each salesperson, what sells, discounts,
// days to close, lost reasons, payment plans. One pull of 25 months of Closed Won deals from HubSpot plus a few counts,
// cached per month for an hour. Months are Eastern-time calendar months, by close date.

export type Won = { day: string; created: string; amount: number; before: number; refunded: number; owner: string; program: string };
export type MonthStat = { n: number; amount: number };
export type Person = { id: string; name: string; month: MonthStat; last: MonthStat; lastYear: MonthStat; avgDeal: number | null; closeDays: number | null; discount: number | null; calls: number; perSale: number | null };
export type SalesInsights = {
  month: string; label: string; today: string; current: boolean; dayOfMonth: number; builtAt: string; notes: string[];
  thisMonth: MonthStat; lastYearToDate: MonthStat; lastYearFull: MonthStat; lastMonthToDate: MonthStat; lastMonthFull: MonthStat; nextMonthLY: MonthStat & { label: string };
  strip: { month: string; label: string; n: number; amount: number; lyN: number; lyAmount: number }[];
  people: Person[];
  leads: { month: number; lastYear: number }; conversion: { month: number | null; lastYear: number | null };
  programs: { program: string; n: number; amount: number; lyN: number }[];
  discount: { month: number | null; lastYear: number | null; share: number | null };   // average % off, and share of deals discounted
  closeDays: { month: number | null; lastYear: number | null };
  lost: { reason: string; n: number; amount: number }[]; planLost: MonthStat; failed: MonthStat | null;
  refunds: MonthStat;
};

const monthLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shortLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) + (m.endsWith("-01") ? ` ${m.slice(2, 4)}` : "");
const addMonths = (m: string, k: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const monthEnd = (m: string) => addDays(`${addMonths(m, 1)}-01`, -1);
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const stat = (xs: Won[]): MonthStat => ({ n: xs.length, amount: xs.reduce((n, d) => n + d.amount, 0) });

export async function buildSalesInsights(month: string, today: string): Promise<SalesInsights | null> {
  if (!hubspotConfigured()) return null;
  const notes: string[] = [];
  const current = month === today.slice(0, 7), dayOfMonth = current ? Number(today.slice(8, 10)) : 31;
  const from = `${addMonths(month, -24)}-01`, to = monthEnd(month);
  const inM = (d: string, m: string) => d.startsWith(m);
  const [won, lost, people] = await Promise.all([closedWonBetween(from, to, 25), lostDealsBetween(`${month}-01`, monthEnd(month)).catch(() => []), salesPeople().catch(() => [])]);
  const rows: Won[] = won.rows.map((d) => { const p = d.properties; return { day: dayET(p.closedate || ""), created: p.createdate ? dayET(p.createdate) : "", amount: Number(p.amount || 0), before: Number(p.price_before_discount || 0), refunded: Number(p.refunded_amount || 0), owner: clean(p.hubspot_owner_id), program: clean(p.type_of_program_sold) || "Not set" }; });
  const ly = addMonths(month, -12), lm = addMonths(month, -1), nmLY = addMonths(month, -11);
  const toDate = (m: string) => rows.filter((d) => inM(d.day, m) && Number(d.day.slice(8, 10)) <= dayOfMonth);
  const thisMonthRows = rows.filter((d) => inM(d.day, month)), lyRows = rows.filter((d) => inM(d.day, ly));
  // 13 months ending at the chosen one, with last year's same months behind
  const strip = Array.from({ length: 13 }, (_, i) => { const m = addMonths(month, i - 12), mLY = addMonths(m, -12); const a = rows.filter((d) => inM(d.day, m)), b = rows.filter((d) => inM(d.day, mLY)); return { month: m, label: shortLabel(m), n: a.length, amount: stat(a).amount, lyN: b.length, lyAmount: stat(b).amount }; });
  // Counts and calls (a handful of searches; they queue at 3 a second)
  const rng = (f: string, t: string) => [{ propertyName: "createdate", operator: "GTE", value: String(etMidnight(f)) }, { propertyName: "createdate", operator: "LT", value: String(etMidnight(addDays(t, 1))) }];
  const mEnd = current ? today : monthEnd(month), lyEnd = current ? addDays(today, -365) : monthEnd(ly);
  const [leadsM, leadsLY, ...calls] = await Promise.all([
    countObjects("deals", rng(`${month}-01`, mEnd)).catch(() => 0), countObjects("deals", rng(`${ly}-01`, lyEnd)).catch(() => 0),
    ...people.map((o) => countObjects("calls", [{ propertyName: "hs_timestamp", operator: "GTE", value: String(etMidnight(`${month}-01`)) }, { propertyName: "hs_timestamp", operator: "LT", value: String(etMidnight(addDays(mEnd, 1))) }, { propertyName: "hubspot_owner_id", operator: "EQ", value: o.id }]).catch(() => 0))
  ]);
  const disc = (xs: Won[]) => { const d = xs.filter((x) => x.before > x.amount && x.before > 0); return d.length ? Math.round(d.reduce((n, x) => n + (1 - x.amount / x.before) * 100, 0) / d.length) : null; };
  const closeDays = (xs: Won[]) => median(xs.filter((x) => x.created).map((x) => Math.max(0, daysBetween(x.created, x.day))));
  const peopleRows: Person[] = people.map((o, i) => {
    const mine = thisMonthRows.filter((d) => d.owner === o.id), m = stat(mine), l = stat(rows.filter((d) => inM(d.day, lm) && d.owner === o.id)), y = stat(lyRows.filter((d) => d.owner === o.id));
    return { id: o.id, name: o.name, month: m, last: l, lastYear: y, avgDeal: m.n ? Math.round(m.amount / m.n) : null, closeDays: closeDays(mine), discount: disc(mine), calls: calls[i] || 0, perSale: m.n && calls[i] ? Math.round(calls[i] / m.n) : null };
  }).filter((p) => p.month.n || p.last.n || p.lastYear.n || p.calls).sort((a, b) => b.month.amount - a.month.amount || b.month.n - a.month.n);
  const progs = new Map<string, { n: number; amount: number; lyN: number }>();
  for (const d of thisMonthRows) { const x = progs.get(d.program) || { n: 0, amount: 0, lyN: 0 }; x.n++; x.amount += d.amount; progs.set(d.program, x); }
  for (const d of lyRows) { const x = progs.get(d.program) || { n: 0, amount: 0, lyN: 0 }; x.lyN++; progs.set(d.program, x); }
  const lostBy = new Map<string, { n: number; amount: number }>(); let planLost = { n: 0, amount: 0 };
  for (const d of lost) { const why = clean(d.properties.closed_lost_reason_new) || "No reason given", amt = Number(d.properties.amount || 0); const x = lostBy.get(why) || { n: 0, amount: 0 }; x.n++; x.amount += amt; lostBy.set(why, x); if (/payment plan/i.test(why)) { planLost.n++; planLost.amount += amt; } }
  let failed: SalesInsights["failed"] = null;
  if (stripeConfigured()) {
    try {
      const charges = await chargeOutcomes(Math.floor(etMidnight(`${month}-01`) / 1000), Math.floor(etMidnight(addDays(monthEnd(month), 1)) / 1000), 15);
      const latest = new Map<string, { status: string; amount: number; created: number }>();
      for (const c of charges) { const cur = latest.get(c.customer); if (!cur || c.created > cur.created) latest.set(c.customer, c); }
      const f = [...latest.values()].filter((c) => c.status === "failed"); failed = { n: f.length, amount: Math.round(f.reduce((n, c) => n + c.amount, 0)) };
    } catch (e) { notes.push(`Stripe: ${(e as Error).message}`); }
  }
  const refunded = thisMonthRows.filter((d) => d.refunded > 0);
  return {
    month, label: monthLabel(month), today, current, dayOfMonth, builtAt: new Date().toISOString(), notes,
    thisMonth: stat(thisMonthRows), lastYearToDate: stat(toDate(ly)), lastYearFull: stat(lyRows), lastMonthToDate: stat(toDate(lm)), lastMonthFull: stat(rows.filter((d) => inM(d.day, lm))),
    nextMonthLY: { ...stat(rows.filter((d) => inM(d.day, nmLY))), label: monthLabel(addMonths(month, 1)).split(" ")[0] },
    strip, people: peopleRows,
    leads: { month: leadsM, lastYear: leadsLY }, conversion: { month: leadsM ? Math.round((thisMonthRows.length / leadsM) * 1000) / 10 : null, lastYear: leadsLY ? Math.round((lyRows.length / leadsLY) * 1000) / 10 : null },
    programs: [...progs.entries()].map(([program, x]) => ({ program, ...x })).sort((a, b) => b.n - a.n),
    discount: { month: disc(thisMonthRows), lastYear: disc(lyRows), share: thisMonthRows.length ? Math.round((thisMonthRows.filter((x) => x.before > x.amount && x.before > 0).length / thisMonthRows.length) * 100) : null },
    closeDays: { month: closeDays(thisMonthRows), lastYear: closeDays(lyRows) },
    lost: [...lostBy.entries()].map(([reason, x]) => ({ reason, ...x })).sort((a, b) => b.n - a.n).slice(0, 5), planLost, failed,
    refunds: { n: refunded.length, amount: refunded.reduce((n, d) => n + d.refunded, 0) }
  };
}

/** Cached per month for an hour ("Refresh from HubSpot" on the page drops it). */
export const salesInsightsCached = unstable_cache(async (month: string, today: string) => buildSalesInsights(month, today), ["sales-insights-v1"], { revalidate: 3600, tags: ["sales-insights"] });
