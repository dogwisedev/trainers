// Payroll rules (pure functions, no database). Agreed with Anita, Oct 2026:
//  - Each trainer has an agreed amount per program type (Sean): 2, 3, 4 weeks, 4/5/6 weeks rehab. e.g. $2,000 for 4 weeks.
//  - Paid by the day: amount ÷ program days (4 weeks = 28 days) × days trained in the pay period.
//    $2,000 for 4 weeks = $71.43 a day, so 14 days in a period = $1,000. Rounding is settled on the last day, so a
//    program always adds up to its exact amount. Extra days after the program keep the same day rate.
//  - 7 and 8 week programs use the 6-week rehab day rate (amount ÷ 42).
//  - Pay runs every other Monday (submitted), paid that Friday. A run covers two program weeks:
//    the week that started the Sunday 8 days before submission, and the week that started the day before.
//  - Missed weekly report / late handover: up to $100 off each (the % is Sean's call).
import { addDays, toDate } from "./dates";

export type Rates = { w2: number | null; w3: number | null; w4: number | null; w4_rehab: number | null; w5_rehab: number | null; w6_rehab: number | null; report_deduction: number; mileage_rate?: number | null; mileage_free_miles?: number | null; followup_rate?: number | null };
export const RATE_FIELDS: [keyof Rates, string][] = [
  ["w2", "2 weeks"], ["w3", "3 weeks"], ["w4", "4 weeks"], ["w4_rehab", "4 weeks rehab"], ["w5_rehab", "5 weeks rehab"], ["w6_rehab", "6 weeks rehab"]
];
export const EMPTY_RATES: Rates = { w2: null, w3: null, w4: null, w4_rehab: null, w5_rehab: null, w6_rehab: null, report_deduction: 100, mileage_rate: null, mileage_free_miles: 0 };

const ANCHOR = "2026-10-26"; // an approval Monday: period Mon Oct 12 - Sun Oct 25, paid Fri Oct 30 (then every 2 weeks)
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ── Pay run dates ───────────────────────────────────────────────────────
export function isPayMonday(iso: string) {
  const days = Math.round((toDate(iso).getTime() - toDate(ANCHOR).getTime()) / 86400000);
  return days % 14 === 0;
}
/** The pay Monday on or after `iso`. */
export function payMondayOnOrAfter(iso: string) {
  const days = Math.round((toDate(iso).getTime() - toDate(ANCHOR).getTime()) / 86400000);
  const k = Math.ceil(days / 14);
  return addDays(ANCHOR, k * 14);
}
/** The pay Monday on or before `iso` (the run that stays on screen until the next pay Monday). */
export function payMondayOnOrBefore(iso: string) {
  const next = payMondayOnOrAfter(iso);
  return next === iso ? iso : addDays(next, -14);
}
/**
 * A pay run: two weeks, Monday to Sunday. Approved the Monday after (submitDate), paid that Friday.
 * e.g. period Mon Oct 12 - Sun Oct 25, approved Mon Oct 26, paid Fri Oct 30. period_end is the last day (the Sunday).
 */
export function runDates(submitDate: string) {
  const periodStart = addDays(submitDate, -14); // Monday, two weeks before
  return { submit_date: submitDate, period_start: periodStart, period_end: addDays(submitDate, -1), paid_date: addDays(submitDate, 4), weeks: [periodStart, addDays(periodStart, 7)] };
}

// ── Rates ───────────────────────────────────────────────────────────────
/** Which program amount applies, and its day rate. daily null = no amount set. */
export function rateFor(rates: Rates, weeks: number, rehab: boolean): { key: keyof Rates | null; label: string; amount: number | null; programDays: number; daily: number | null } {
  const pick = (key: keyof Rates, label: string, rateWeeks: number) => {
    const amount = (rates[key] as number | null) ?? null;
    return { key, label, amount, programDays: rateWeeks * 7, daily: amount == null ? null : amount / (rateWeeks * 7) };
  };
  if (weeks >= 6) return pick("w6_rehab", weeks > 6 ? `${weeks} weeks (6-week day rate)` : "6 weeks rehab", 6);
  if (weeks === 5) return pick("w5_rehab", "5 weeks rehab", 5);
  if (weeks === 4) return rehab ? pick("w4_rehab", "4 weeks rehab", 4) : pick("w4", "4 weeks", 4);
  if (weeks === 3) return pick("w3", "3 weeks", 3);
  if (weeks === 2) return pick("w2", "2 weeks", 2);
  return { key: null, label: `${weeks} week${weeks === 1 ? "" : "s"}`, amount: null, programDays: weeks * 7, daily: null };
}

/**
 * Pay for days `fromDay`..`fromDay+count-1` of a booking (0-based, counted from the booking's first day).
 * Cumulative rounding: what's been paid after k days is round(daily × k), so the parts always add up
 * to exactly the program amount (and the 6-week amount stays exact for 6 weeks).
 */
export function payForDays(rates: Rates, programWeeks: number, rehab: boolean, fromDay: number, count: number): number | null {
  const r = rateFor(rates, programWeeks, rehab);
  if (r.daily == null) return null;
  const paidAfter = (k: number) => (k === r.programDays ? (r.amount as number) : round2(r.daily! * k));
  return round2(paidAfter(fromDay + count) - paidAfter(fromDay));
}

// ── Building a draft from bookings ──────────────────────────────────────
export type BookingLike = { id: string; trainer_id: string; client_name: string; dog_name: string | null; start_date: string; end_date: string; weeks: number | null; extra_days?: number | null; rehab?: boolean | null; status: string };
export type DraftLine = { kind: "training"; booking_id: string; weeks_completed: number | null; days: number | null; week_from: number | null; client: string; dog: string; program: string; amount: number; missingRate: boolean };

export function programLabel(weeks: number, rehab: boolean, extraDays = 0) {
  return `${weeks} weeks${rehab ? " RR" : ""}${extraDays ? ` + ${extraDays} day${extraDays === 1 ? "" : "s"}` : ""}`;
}

const DAY = 86400000;
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);

/** One line per booking: the days it was in training during the pay period (incl. extra days), paid by the day. */
export function draftLines(bookings: BookingLike[], rates: Rates, runWeeks: string[]): DraftLine[] {
  const out: DraftLine[] = [];
  const periodStart = runWeeks[0], periodEnd = addDays(runWeeks[runWeeks.length - 1], 6); // 14 days, Sunday to Saturday
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    // Paid days run from pickup to the night before drop-off (end_date is the drop-off day, not paid)
    const care = daysBetween(b.start_date, b.end_date), last = care > 0 ? addDays(b.end_date, -1) : b.end_date;
    const programWeeks = b.weeks || Math.max(1, Math.floor(Math.max(1, care) / 7));
    const extra = Math.max(0, b.extra_days ?? (care - programWeeks * 7));
    const from = b.start_date > periodStart ? b.start_date : periodStart;
    const to = last < periodEnd ? last : periodEnd;
    if (from > to) continue;
    const days = daysBetween(from, to) + 1, fromDay = daysBetween(b.start_date, from);
    const amount = payForDays(rates, programWeeks, !!b.rehab, fromDay, days);
    out.push({
      kind: "training", booking_id: b.id, weeks_completed: days % 7 === 0 ? days / 7 : null, days, week_from: Math.floor(fromDay / 7) + 1,
      client: b.client_name, dog: b.dog_name || "", program: programLabel(programWeeks, !!b.rehab, extra), amount: amount ?? 0, missingRate: amount == null
    });
  }
  return out.sort((a, b) => a.client.localeCompare(b.client));
}

export const deductionAmount = (rates: Rates, pct: number) => -round2((rates.report_deduction || 100) * (pct / 100));
export const sumLines = (lines: { amount: number | string }[]) => round2(lines.reduce((n, l) => n + Number(l.amount || 0), 0));
export const money = (n: number | string) => {
  const v = Number(n || 0);
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// ── American dates, payslip style ───────────────────────────────────────
const ord = (d: number) => `${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`;
export const usDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${m}/${d}/${y}`; };
/** "Aug 17th - 31st", or "Aug 31st - Sep 14th" across months */
export function periodLabel(start: string, end: string) {
  const s = toDate(start), e = toDate(end);
  const mon = (d: Date) => d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return s.getUTCMonth() === e.getUTCMonth() ? `${mon(s)} ${ord(s.getUTCDate())} - ${ord(e.getUTCDate())}` : `${mon(s)} ${ord(s.getUTCDate())} - ${mon(e)} ${ord(e.getUTCDate())}`;
}

// ── Mileage ─────────────────────────────────────────────────────────────
// Per trip: (miles driven − the trainer's free miles) × their rate per mile. Nothing below the free miles.
// e.g. 40 miles, paid over 20 miles, at $0.30 = 20 × 0.30 = $6.00. Trips come from the pickup and drop-off forms
// and from follow-up sessions, and are paid in the pay run whose two weeks contain the trip date.
export type TripLike = { id: string; trainer_id: string; booking_id: string | null; kind: "pickup" | "dropoff" | "followup"; trip_date: string; miles: number | string; client?: string | null; dog?: string | null };
export const TRIP_LABEL: Record<TripLike["kind"], string> = { pickup: "Pickup", dropoff: "Drop-off", followup: "Follow-up session" };
export function mileagePay(miles: number, freeMiles: number, rate: number | null | undefined): { paidMiles: number; amount: number | null } {
  const paidMiles = Math.max(0, Math.round((miles - (freeMiles || 0)) * 10) / 10);
  return { paidMiles, amount: rate == null ? null : round2(paidMiles * rate) };
}
export type RouteLine = { kind: "route"; booking_id: string | null; client: string; dog: string; program: string; amount: number; days: null; weeks_completed: null; week_from: null; missingRate: boolean; trip_id: string };
/** One pay line per trip in the pay period. */
export function routeLines(trips: TripLike[], rates: Rates, periodStart: string, periodEnd: string): RouteLine[] {
  return trips.filter((t) => t.trip_date >= periodStart && t.trip_date < periodEnd).sort((a, b) => a.trip_date.localeCompare(b.trip_date)).map((t) => {
    const miles = Number(t.miles), free = Number(rates.mileage_free_miles || 0), rate = rates.mileage_rate == null ? null : Number(rates.mileage_rate);
    const p = mileagePay(miles, free, rate);
    const what = `${TRIP_LABEL[t.kind]} ${t.trip_date.slice(5).replace("-", "/")}: ${miles} mi`;
    const program = p.amount == null ? `${what} (no mileage rate set)` : p.paidMiles ? `${what}, ${p.paidMiles} paid at $${rate!.toFixed(2)}` : `${what}, under ${free} mi`;
    return { kind: "route", booking_id: t.booking_id, client: t.client || "", dog: t.dog || "", program, amount: p.amount ?? 0, days: null, weeks_completed: null, week_from: null, missingRate: p.amount == null, trip_id: t.id };
  });
}

// ── Probation ───────────────────────────────────────────────────────────
// A trainer on probation (or declined) gets 75% of program pay; the other 25% is held (it shows on the line).
// When an admin approves, everything held so far is paid as one line in the next pay run.
export const PROBATION_SHARE = 0.75;
export const PROBATION_NOTE = "Probation: 75% paid, 25% held";
/** Held amount behind a probation line paid at 75%. */
export const heldFrom = (paid: number) => round2(paid / PROBATION_SHARE * (1 - PROBATION_SHARE));
export function applyProbation<T extends { kind: string; amount: number; program: string }>(lines: T[], onProbation: boolean): (T & { description?: string | null })[] {
  if (!onProbation) return lines;
  return lines.map((l) => (l.kind === "training" && l.amount > 0 ? { ...l, amount: round2(l.amount * PROBATION_SHARE), program: `${l.program} (75%, probation)`, description: PROBATION_NOTE } : l));
}
