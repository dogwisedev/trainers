import { Booking, TimeOff, Trainer } from "./types";
import { addDays, overlaps } from "./dates";

export type WeekUse = { week: string; cap: number; dogs: Booking[]; blocked: number; free: number; offNote: string | null };

/** How a trainer's kennels are used, week by week. Blocked = time off (whole or some kennels). */
export function weekUsage(t: Trainer, bookings: Booking[], off: TimeOff[], weeks: string[]): WeekUse[] {
  return weeks.map((week) => {
    const end = addDays(week, 6);
    const dogs = bookings.filter((b) => b.trainer_id === t.id && b.status !== "cancelled" && overlaps(b.start_date, b.end_date, week, end));
    const offs = off.filter((o) => o.trainer_id === t.id && overlaps(o.start_date, o.end_date, week, end));
    const blocked = Math.min(t.capacity, offs.reduce((n, o) => n + (o.slots_blocked ?? t.capacity), 0));
    const free = Math.max(0, t.capacity - dogs.length - blocked);
    return { week, cap: t.capacity, dogs, blocked, free, offNote: offs[0] ? (offs[0].note || (offs[0].reason === "Time off" ? null : offs[0].reason)) : null };
  });
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
