import { PROGRAMS, programFor } from "./programs";
// Pure scheduling for training materials (no database), so it's easy to test.
// During the program: items in their set order, Item 1 on the plan's first day (Day 1 = pickup), the rest spread
// evenly up to the day before drop-off, at most one a day; items that don't fit are skipped.
// After drop-off: Item 1 N days after drop-off, then one every N days.

export type PlanItem = { id: string; position: number };
export type Planned = { id: string; position: number; on: string | null }; // on = null: no day left (skipped)

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400e3);

export function planDuring(items: PlanItem[], pickup: string, dropOff: string, firstDay = 2): Planned[] {
  const list = [...items].sort((a, b) => a.position - b.position);
  const lastDay = daysBetween(pickup, dropOff);        // Day N = the day before drop-off (Day 1 = pickup)
  const available = Math.max(0, lastDay - firstDay + 1);
  return list.map((it, i) => {
    if (i >= available) return { ...it, on: null };       // more items than days: the extras are skipped
    const n = Math.min(list.length, available);
    const day = n <= 1 ? firstDay : firstDay + Math.round((i * (available - 1)) / (n - 1));
    return { ...it, on: addDays(pickup, day - 1) };
  });
}

export function planAfter(items: PlanItem[], dropOff: string, startAfter = 2, everyDays = 4): Planned[] {
  return [...items].sort((a, b) => a.position - b.position).map((it, i) => ({ ...it, on: addDays(dropOff, startAfter + i * everyDays) }));
}

/** Today's send time for a chat: a steady "random" minute between 12:00 and 5:30 PM Eastern (so a 10-minute check always reaches it). */
export function sendMinute(dealKey: string, day: string): number {
  let h = 2166136261;
  for (const ch of `${dealKey}|${day}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return 12 * 60 + (h % 330);
}

export const PLANS = [...PROGRAMS, "after"] as const;
export type PlanName = (typeof PLANS)[number];
export const planLabel = (p: string) => (p === "after" ? "After drop-off" : p);

export type PlanSettings = { plan: string; first_day: number; start_after: number; every_days: number };
export const DEFAULT_SETTINGS = (plan: string): PlanSettings => ({ plan, first_day: 2, start_after: 2, every_days: 4 });
/** The program used for a booking's materials: the one an admin picked, else the booking's own program name. */
export const bookingProgram = (b: { program?: string | null; program_choice?: string | null }) => programFor(b.program_choice || "") || programFor(b.program || "");

export type Bk = { id: string; hubspot_deal_id: string | null; dog_name: string | null; start_date: string; end_date: string; status: string; program: string | null; program_choice: string | null; training_paused: boolean; created_at: string };
export type DealSchedule = { program: string | null; paused: boolean; during: Planned[]; after: Planned[]; start: string; end: string; lead: Bk };

/** One chat's schedule: the deal's first booking's program, from the first pickup to the last drop-off. */
export function scheduleFor(bookings: Bk[], materials: { id: string; plan: string; position: number }[], settings: Map<string, PlanSettings>): DealSchedule | null {
  const live = bookings.filter((b) => b.status !== "cancelled").sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!live.length) return null;
  const lead = live.find((b) => bookingProgram(b)) || live[0]; // two dogs on one deal: the first one with a clear program sets the list
  const start = live.reduce((m, b) => (b.start_date < m ? b.start_date : m), live[0].start_date);
  const end = live.reduce((m, b) => (b.end_date > m ? b.end_date : m), live[0].end_date);
  const program = bookingProgram(lead);
  const s = settings.get(program || "") || DEFAULT_SETTINGS(program || "");
  const a = settings.get("after") || DEFAULT_SETTINGS("after");
  const during = program ? planDuring(materials.filter((m) => m.plan === program), start, end, s.first_day) : [];
  const after = planAfter(materials.filter((m) => m.plan === "after"), end, a.start_after, a.every_days);
  return { program, paused: live.some((b) => b.training_paused), during, after, start, end, lead };
}

