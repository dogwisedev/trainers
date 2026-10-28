// US Eastern time for the communication tools (lib/claudeComms.ts): the Eastern date of a moment, the moment an Eastern
// hour starts, and how many hours between two moments fall inside waking hours. Pure (no database, no imports) and
// cached, so it stays fast over thousands of messages. The chat check (lib/chatRules.ts) counts waking hours the same way.
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
});
function parts(ms: number) {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return p;
}

/** The US Eastern calendar date (YYYY-MM-DD) of a moment. */
export function etDate(ms: number): string {
  const p = parts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

/** What to add to a UTC moment to get Eastern wall-clock time, at that moment (-4 or -5 hours). */
function offset(ms: number) {
  const p = parts(ms);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

const starts = new Map<string, number>();
/** The moment it is `hour` o'clock Eastern on `date` (YYYY-MM-DD). Right on clock-change days too for 3 am to midnight. */
export function etAt(date: string, hour: number): number {
  const key = `${date}T${hour}`;
  const hit = starts.get(key);
  if (hit !== undefined) return hit;
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour);
  let t = wall - offset(wall);
  t = wall - offset(t);
  starts.set(key, t);
  return t;
}

/** The day after (or n days after) a YYYY-MM-DD date. */
export const nextDay = (date: string, n = 1) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n)).toISOString().slice(0, 10);

/** Hours between two moments that fall between `from` and `to` o'clock Eastern (default 8 am to 9 pm), to one decimal. */
export function wakingHoursBetween(fromMs: number, toMs: number, from = 8, to = 21): number {
  if (!(toMs > fromMs)) return 0;
  let total = 0;
  const last = etDate(toMs);
  for (let d = etDate(fromMs), n = 0; d <= last && n < 400; d = nextDay(d), n++) {
    const s = Math.max(fromMs, etAt(d, from)), e = Math.min(toMs, etAt(d, to));
    if (e > s) total += e - s;
  }
  return Math.round(total / 360000) / 10;
}
