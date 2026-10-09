// Payroll rules (pure functions, no database). Agreed with Anita, Oct 2026:
//  - Each trainer has a WEEKLY rate per program type (agreed with Sean): 2, 3, 4 weeks, 4/5/6 weeks rehab.
//    7–8 week programs use the 6-week rehab weekly rate.
//  - Pay = weekly rate × weeks completed. Extra days past the last full week are paid at weekly rate ÷ 7 per day.
//  - Pay runs every other Monday (submitted), paid that Friday. A run covers two program weeks:
//    the week that started the Sunday 8 days before submission, and the week that started the day before.
//  - Missed weekly report / late handover: up to $100 off each (the % is Sean's call).
import { addDays, toDate } from "./dates";

export type Rates = { w2: number | null; w3: number | null; w4: number | null; w4_rehab: number | null; w5_rehab: number | null; w6_rehab: number | null; report_deduction: number };
export const RATE_FIELDS: [keyof Rates, string][] = [
  ["w2", "2 weeks"], ["w3", "3 weeks"], ["w4", "4 weeks"], ["w4_rehab", "4 weeks rehab"], ["w5_rehab", "5 weeks rehab"], ["w6_rehab", "6 weeks rehab"]
];
export const EMPTY_RATES: Rates = { w2: null, w3: null, w4: null, w4_rehab: null, w5_rehab: null, w6_rehab: null, report_deduction: 100 };

const ANCHOR = "2026-10-05"; // a submission Monday (paid Fri Oct 9, 2026)
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
export function runDates(submitDate: string) {
  const periodStart = addDays(submitDate, -8); // Sunday
  return { submit_date: submitDate, period_start: periodStart, period_end: addDays(periodStart, 14), paid_date: addDays(submitDate, 4), weeks: [periodStart, addDays(periodStart, 7)] };
}

// ── Rates ───────────────────────────────────────────────────────────────
/** Which weekly rate applies to a program. weekly null = no rate set. */
export function rateFor(rates: Rates, weeks: number, rehab: boolean): { key: keyof Rates | null; label: string; weekly: number | null } {
  const pick = (key: keyof Rates, label: string) => ({ key, label, weekly: (rates[key] as number | null) ?? null });
  if (weeks >= 6) return pick("w6_rehab", weeks > 6 ? `${weeks} weeks (6-week rate)` : "6 weeks rehab");
  if (weeks === 5) return pick("w5_rehab", "5 weeks rehab");
  if (weeks === 4) return rehab ? pick("w4_rehab", "4 weeks rehab") : pick("w4", "4 weeks");
  if (weeks === 3) return pick("w3", "3 weeks");
  if (weeks === 2) return pick("w2", "2 weeks");
  return { key: null, label: `${weeks} week${weeks === 1 ? "" : "s"}`, weekly: null };
}

/** Pay for `count` full weeks of a program. */
export function payForWeeks(rates: Rates, programWeeks: number, rehab: boolean, count: number): number | null {
  const w = rateFor(rates, programWeeks, rehab).weekly;
  return w == null ? null : round2(w * count);
}
/** Pay for extra days past the program's last full week: weekly ÷ 7 per day. */
export function payForDays(rates: Rates, programWeeks: number, rehab: boolean, days: number): number | null {
  const w = rateFor(rates, programWeeks, rehab).weekly;
  return w == null ? null : round2((w / 7) * days);
}

// ── Building a draft from bookings ──────────────────────────────────────
export type BookingLike = { id: string; trainer_id: string; client_name: string; dog_name: string | null; start_date: string; end_date: string; weeks: number | null; extra_days?: number | null; rehab?: boolean | null; status: string };
export type DraftLine = { kind: "training"; booking_id: string; weeks_completed: number | null; days: number | null; week_from: number | null; client: string; dog: string; program: string; amount: number; missingRate: boolean };

export function programLabel(weeks: number, rehab: boolean, extraDays = 0) {
  return `${weeks} weeks${rehab ? " RR" : ""}${extraDays ? ` + ${extraDays} day${extraDays === 1 ? "" : "s"}` : ""}`;
}

const DAY = 86400000;
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);

/** Lines for one trainer in one run: full program weeks inside the run's two weeks, plus any extra days that fall in it. */
export function draftLines(bookings: BookingLike[], rates: Rates, runWeeks: string[]): DraftLine[] {
  const out: DraftLine[] = [];
  const runEnd = addDays(runWeeks[runWeeks.length - 1], 6);
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    const programWeeks = b.weeks || Math.max(1, Math.floor((daysBetween(b.start_date, b.end_date) + 1) / 7));
    const extra = Math.max(0, b.extra_days ?? (daysBetween(b.start_date, b.end_date) + 1 - programWeeks * 7));
    const rehab = !!b.rehab;
    const program = programLabel(programWeeks, rehab, extra);

    // Full weeks
    const idx = runWeeks.map((w) => Math.round(daysBetween(b.start_date, w) / 7)).filter((i) => i >= 0 && i < programWeeks);
    if (idx.length) {
      const amount = payForWeeks(rates, programWeeks, rehab, idx.length);
      out.push({ kind: "training", booking_id: b.id, weeks_completed: idx.length, days: null, week_from: Math.min(...idx) + 1,
        client: b.client_name, dog: b.dog_name || "", program, amount: amount ?? 0, missingRate: amount == null });
    }
    // Extra days (after the last full week)
    if (extra > 0) {
      const extraStart = addDays(b.start_date, programWeeks * 7), extraEnd = addDays(extraStart, extra - 1);
      const from = extraStart > runWeeks[0] ? extraStart : runWeeks[0], to = extraEnd < runEnd ? extraEnd : runEnd;
      const n = from <= to ? daysBetween(from, to) + 1 : 0;
      if (n > 0) {
        const amount = payForDays(rates, programWeeks, rehab, n);
        out.push({ kind: "training", booking_id: b.id, weeks_completed: null, days: n, week_from: null,
          client: b.client_name, dog: b.dog_name || "", program, amount: amount ?? 0, missingRate: amount == null });
      }
    }
  }
  return out.sort((a, b) => a.client.localeCompare(b.client) || (a.days ? 1 : 0) - (b.days ? 1 : 0));
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
