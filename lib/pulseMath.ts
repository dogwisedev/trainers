// Pulse (the dashboard): the maths, kept pure so it can be tested.
//  - Reply times count waking hours only (8 AM–8 PM Eastern): a message at 11 PM answered at 8:10 AM is a 10-minute reply.
//  - Medians and 90th percentiles for times, never averages.
//  - Rates are shown with a lower confidence bound (Wilson), so 9/10 ranks below 48/50 and thin data never tops a list.

const ET = "America/New_York";
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: ET, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Eastern-time day ("2026-10-29") for an instant. */
export function dayET(ts: string | number | Date): string {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Minutes offset of Eastern time from UTC at an instant (-240 in summer, -300 in winter), cached per hour. */
const offCache = new Map<number, number>();
export function etOffsetMinutes(ms: number): number {
  const key = Math.floor(ms / 3600000);
  const hit = offCache.get(key);
  if (hit !== undefined) return hit;
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const off = Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
  offCache.set(key, off);
  return off;
}

export const WAKE_START = 8, WAKE_END = 20; // 8 AM to 8 PM Eastern

/** Waking-hours minutes between two instants (8 AM–8 PM Eastern), capped at 7 days. */
export function wakingMinutes(from: string | number, to: string | number): number {
  const a = typeof from === "number" ? from : Date.parse(from), b = typeof to === "number" ? to : Date.parse(to);
  if (!(b > a)) return 0;
  const la = a + etOffsetMinutes(a) * 60000, lb = Math.min(b, a + 7 * 86400000) + etOffsetMinutes(b) * 60000; // local wall-clock ms
  let total = 0;
  for (let day = Math.floor(la / 86400000) * 86400000; day < lb; day += 86400000) {
    const ws = day + WAKE_START * 3600000, we = day + WAKE_END * 3600000;
    const s = Math.max(la, ws), e = Math.min(lb, we);
    if (e > s) total += e - s;
  }
  return Math.round(total / 60000);
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** Lower bound of a 95% Wilson interval for k successes in n trials (0 when n is 0). Rank rates by this, not by k/n. */
export function wilsonLower(k: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n), spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (centre - spread) / d);
}

/** Small samples pulled toward the group figure: (n·x + k·group) / (n + k). k ≈ 10 events. */
export const shrink = (x: number, n: number, group: number, k = 10) => (n + k > 0 ? (n * x + k * group) / (n + k) : group);

/** "1h 10m", "25m", "2d 3h" */
export function minutesLabel(m: number | null): string {
  if (m == null) return "–";
  if (m < 60) return `${m}m`;
  if (m < 12 * 60) return `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
  const d = Math.floor(m / (12 * 60)); // a waking day is 12 hours
  const h = Math.floor((m - d * 12 * 60) / 60);
  return `${d}d ${h ? `${h}h` : ""}`.trim();
}

/** Reply times in a chat: from the first unanswered client message to the next reply by staff (a run of client messages counts once). */
export function replyRuns(messages: { role: string; at: string }[]): { minutes: number; by: string; askedAt: string }[] {
  const out: { minutes: number; by: string; askedAt: string }[] = [];
  let pending: string | null = null;
  for (const m of [...messages].sort((a, b) => a.at.localeCompare(b.at))) {
    if (m.role === "client") { if (!pending) pending = m.at; }
    else if (m.role === "trainer" || m.role === "admin") { if (pending) { out.push({ minutes: wakingMinutes(pending, m.at), by: m.role, askedAt: pending }); pending = null; } }
  }
  return out;
}

/** The change from a previous value, as a label ("+12%", "−3", "new"). */
export function delta(now: number | null, before: number | null, pct = false): { text: string; up: boolean | null } {
  if (now == null || before == null) return { text: "", up: null };
  if (before === 0) return { text: now === 0 ? "same" : "new", up: now === 0 ? null : true };
  const d = now - before;
  if (!d) return { text: "same", up: null };
  const text = pct ? `${d > 0 ? "+" : "−"}${Math.abs(Math.round((d / before) * 100))}%` : `${d > 0 ? "+" : "−"}${Math.abs(Math.round(d * 10) / 10)}`;
  return { text, up: d > 0 };
}
