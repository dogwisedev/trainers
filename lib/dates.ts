// All calendar maths in whole days, as ISO "YYYY-MM-DD" strings. Weeks start on Sunday, like the old sheet.
const DAY = 86400000;
export const toDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const toIso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => toIso(new Date(toDate(iso).getTime() + n * DAY));
export const todayIso = () => { const n = new Date(); return toIso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))); };
export const weekStart = (iso: string) => addDays(iso, -toDate(iso).getUTCDay());
export const weeksFrom = (iso: string, n: number) => Array.from({ length: n }, (_, i) => addDays(weekStart(iso), i * 7));
export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && bStart <= aEnd;
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
// A booking's end date is the DROP-OFF day (same weekday as pickup, X weeks later, like HubSpot's Training End Date).
// The drop-off day doesn't take a kennel and isn't paid: the dog is in care from pickup up to the night before.
/** Last full day in care (the day before drop-off). */
export const lastDay = (b: { start_date: string; end_date: string }) => (b.end_date > b.start_date ? addDays(b.end_date, -1) : b.end_date);
/** Days in care = drop-off minus pickup (a 3-week program = 21). */
export const careDays = (b: { start_date: string; end_date: string }) => Math.max(1, daysBetween(b.start_date, b.end_date));
/** Drop-off day for a program of `weeks` weeks plus extra days. */
export const dropOff = (start: string, weeks: number, extra = 0) => addDays(start, weeks * 7 + extra);

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => toDate(iso).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
export const short = (iso: string) => fmt(iso, { month: "short", day: "numeric" });
export const long = (iso: string) => fmt(iso, { weekday: "short", month: "short", day: "numeric" });
export const range = (a: string, b: string) => `${short(a)} to ${short(b)}`;
export const weekLabel = (iso: string) => { const t = weekStart(todayIso()); return iso === t ? "This week" : iso === addDays(t, 7) ? "Next week" : `Week of ${short(iso)}`; };
export const timeAgo = (ts: string) => {
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
