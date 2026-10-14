import { Booking, TimeOff, Trainer } from "./types";
import { addDays, lastDay, overlaps } from "./dates";

export type WeekUse = { week: string; cap: number; dogs: Booking[]; peak: number; blocked: number; free: number; offNote: string | null };

/**
 * How a trainer's kennels are used, week by week. Blocked = time off (whole or some kennels).
 * Counted day by day: with real pickup dates (from HubSpot), a dog leaving Tuesday and one arriving Thursday share a kennel,
 * so `free` is what's left on the busiest day of the week. `dogs` is every dog there at some point that week.
 */
export function weekUsage(t: Trainer, bookings: Booking[], off: TimeOff[], weeks: string[]): WeekUse[] {
  return weeks.map((week) => {
    const end = addDays(week, 6);
    // Kennel days run from pickup to the night before drop-off: the drop-off day is free for the next dog
    const dogs = bookings.filter((b) => b.trainer_id === t.id && b.status !== "cancelled" && overlaps(b.start_date, lastDay(b), week, end));
    const offs = off.filter((o) => o.trainer_id === t.id && overlaps(o.start_date, o.end_date, week, end));
    let peak = 0, blocked = 0, load = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(week, i);
      const dogsD = dogs.filter((b) => b.start_date <= d && d <= lastDay(b)).length;
      const blockD = Math.min(t.capacity, offs.filter((o) => o.start_date <= d && d <= o.end_date).reduce((n, o) => n + (o.slots_blocked ?? t.capacity), 0));
      peak = Math.max(peak, dogsD); blocked = Math.max(blocked, blockD); load = Math.max(load, dogsD + blockD);
    }
    const free = Math.max(0, t.capacity - load);
    return { week, cap: t.capacity, dogs, peak, blocked, free, offNote: offs[0] ? (offs[0].note || (offs[0].reason === "Time off" ? null : offs[0].reason)) : null };
  });
}

/** Days in a date range where a trainer has more dogs (plus blocked kennels) than kennels. */
export function overbookedDays(t: Pick<Trainer, "id" | "capacity">, bookings: Pick<Booking, "trainer_id" | "status" | "start_date" | "end_date">[], off: Pick<TimeOff, "trainer_id" | "start_date" | "end_date" | "slots_blocked">[], from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dogs = bookings.filter((b) => b.trainer_id === t.id && b.status !== "cancelled" && b.start_date <= d && d <= lastDay(b)).length;
    const blocked = Math.min(t.capacity, off.filter((o) => o.trainer_id === t.id && o.start_date <= d && d <= o.end_date).reduce((n, o) => n + (o.slots_blocked ?? t.capacity), 0));
    if (dogs > 0 && dogs + blocked > t.capacity) out.push(d);
    if (out.length > 120) break;
  }
  return out;
}

/** First week a dog could start and stay `len` weeks with a kennel free every week. */
export function soonestOpening(use: WeekUse[], len: number): string | null {
  for (let i = 0; i + len <= use.length; i++) if (use.slice(i, i + len).every((w) => w.free > 0)) return use[i].week;
  return null;
}

export const utilisation = (use: WeekUse[]) => {
  const cap = use.reduce((n, w) => n + w.cap, 0);
  return cap ? use.reduce((n, w) => n + w.dogs.length, 0) / cap : 0;
};
