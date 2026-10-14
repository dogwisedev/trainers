// How HubSpot's deal dates become booking dates. Pure functions (no database, no HubSpot), so they're easy to test.
//
// HubSpot holds one start (and maybe one end) per deal, but a deal can have several dogs on their own dates.
//  - The deal's start date is the FIRST dog's pickup. Every dog on the deal moves by the same number of days,
//    so dogs that start later keep their gap.
//  - The deal's end date (if HubSpot has one) is when the LAST dog goes home: the dog(s) that end last take it.
//    Other dogs keep their own length. No end date in HubSpot = every dog keeps its length.
//  - End dates are drop-off days. Days in care = drop-off minus pickup; extra days = beyond the program's full weeks (0 to 13).
import { addDays, daysBetween } from "./dates";

export type PlanIn = { id: string; dog_name: string | null; start_date: string; end_date: string; weeks: number | null; extra_days: number | null };
export type PlanOut = { id: string; start: string; end: string; extra: number; weeks: number; oldDays: number; newDays: number; changed: boolean };

const days = (s: string, e: string) => Math.max(1, daysBetween(s, e)); // end = drop-off day, not a day in care

export function planDeal(list: PlanIn[], hsStart: string, hsEnd: string | null): { plan: PlanOut[]; problem?: string } {
  if (!list.length) return { plan: [] };
  if (hsEnd && hsEnd < hsStart) return { plan: [], problem: `HubSpot's end date (${hsEnd}) is before its start date (${hsStart}).` };
  const first = list.reduce((m, b) => (b.start_date < m ? b.start_date : m), list[0].start_date);
  const delta = daysBetween(first, hsStart);
  const moved = list.map((b) => ({ b, start: addDays(b.start_date, delta), end: addDays(b.end_date, delta) }));
  if (hsEnd) {
    const lastEnd = moved.reduce((m, x) => (x.end > m ? x.end : m), moved[0].end);
    for (const x of moved.filter((m) => m.end === lastEnd)) {
      if (hsEnd < x.start) return { plan: [], problem: `HubSpot's end date (${hsEnd}) is before ${x.b.dog_name || "a dog"}'s start (${x.start}). Check the dates on the deal.` };
      x.end = hsEnd;
    }
  }
  const plan: PlanOut[] = [];
  for (const { b, start, end } of moved) {
    const n = days(start, end);
    const weeks = b.weeks || Math.max(1, Math.floor(n / 7));
    const extra = n - weeks * 7;
    if (extra > 13) return { plan: [], problem: `${b.dog_name || "A dog"}: HubSpot's dates give ${n} days, more than the ${weeks}-week program plus 13 days. Check the dates or the program length.` };
    const ex = Math.max(0, extra);
    plan.push({ id: b.id, start, end, extra: ex, weeks, oldDays: days(b.start_date, b.end_date), newDays: n,
      changed: start !== b.start_date || end !== b.end_date || ex !== (b.extra_days ?? 0) });
  }
  return { plan };
}
