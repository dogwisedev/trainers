// Assign or Ask (OPS 08). For one deal and one trainer: which lane, and why. Pure, so the app's Book now picker, the
// booking checks and the Sales Assistant all give the same answer.
//   hidden  Hold, inactive, or probation declined: not shown
//   blocked doesn't take this program (their declared program types)
//   pedro   on probation, or the client is outside their range: "Ask Pedro" (Pedro approves, then Book now)
//   offer   over capacity on some night (bonus dog), short notice (3 days or less), or on Watch: check with the trainer first
//   assign  none of the above: Book now, tell the trainer
export type Lane = "assign" | "offer" | "pedro" | "blocked" | "hidden";
export type Reason = { code: "hold" | "inactive" | "program" | "probation" | "range" | "capacity" | "short" | "watch"; text: string; hours?: number; call?: string };
export type LaneTrainer = { id: string; name: string; active: boolean; status_board?: string | null; probation?: string | null; capacity: number; range_miles: number; program_types?: string[] | null };
export type LaneDeal = { start: string; end: string; program: string | null; dogs: number; today: string };
export type Night = { date: string; dogs: number; blocked: number };   // the trainer's kennels on each night of this program
export type LaneResult = { lane: Lane; reasons: Reason[]; hours: number | null; clash: string[] };

const plus = (s: string, n: number) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const short = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const REHAB = /rescue restart|anxiety|reactivity|aggression/i;

/** The nights a program uses a kennel: pickup day to the night before drop-off (the drop-off day is free for the next dog). */
export function programNights(start: string, end: string): string[] { const out: string[] = []; for (let d = start; d < end; d = plus(d, 1)) out.push(d); return out.length ? out : [start]; }

/**
 * @param roadMiles one way, trainer → client (straight-line if the route isn't known)
 * @param programsBefore how many programs the trainer has had (for "probation, program N")
 * @param nights the trainer's dogs and blocked kennels on each night of this program (programNights)
 * @param approved Pedro has already approved this trainer for this deal
 */
export function laneFor(t: LaneTrainer, d: LaneDeal, roadMiles: number | null, programsBefore: number, nights: Night[], approved = false): LaneResult {
  const reasons: Reason[] = [];
  const status = String(t.status_board || "active").toLowerCase(), prob = String(t.probation || "none").toLowerCase();
  if (!t.active) return { lane: "hidden", reasons: [{ code: "inactive", text: "Not active" }], hours: null, clash: [] };
  if (status === "hold" || prob === "declined") return { lane: "hidden", reasons: [{ code: "hold", text: "On Hold" }], hours: null, clash: [] };
  const types = (t.program_types || []).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (types.length && d.program && !types.includes(d.program.trim().toLowerCase())) return { lane: "blocked", reasons: [{ code: "program", text: `Doesn't take ${d.program}` }], hours: null, clash: [] };
  // Ask Pedro: probation, or outside their range
  if (prob === "on") { const n = programsBefore + 1; reasons.push({ code: "probation", text: `On probation · program ${n}${d.program && REHAB.test(d.program) ? " · rehab" : ""}`, hours: n <= 2 ? 12 : 24, call: "Always" }); }
  if (roadMiles != null && roadMiles > t.range_miles) reasons.push({ code: "range", text: `${Math.round(roadMiles * 2)} mi round trip · range ${t.range_miles} mi each way`, hours: 24 });
  // Check with the trainer first: capacity on any night, short notice, Watch
  const clash = nights.filter((n) => n.dogs + n.blocked + d.dogs > t.capacity).map((n) => n.date);
  if (clash.length) reasons.push({ code: "capacity", text: `Bonus dog: over ${t.capacity} ${t.capacity === 1 ? "kennel" : "kennels"} ${clash.length === 1 ? `on ${short(clash[0])}` : `${short(clash[0])}–${short(clash[clash.length - 1])}`}`, hours: 24 });
  const until = daysBetween(d.today, d.start);
  if (until <= 3) reasons.push({ code: "short", text: until < 0 ? `Pickup was ${short(d.start)}` : until === 0 ? "Pickup today" : `Pickup in ${until} day${until === 1 ? "" : "s"}`, hours: 4, call: "If no reply in 2 hours" });
  if (status === "watch") reasons.push({ code: "watch", text: "On Watch", hours: 12, call: "Always" });
  const pedro = reasons.some((r) => r.code === "probation" || r.code === "range");
  const lane: Lane = pedro && !approved ? "pedro" : reasons.some((r) => ["capacity", "short", "watch"].includes(r.code)) ? "offer" : "assign";
  const hours = lane === "assign" ? null : Math.min(...reasons.filter((r) => (lane === "pedro" ? true : ["capacity", "short", "watch"].includes(r.code)) && r.hours).map((r) => r.hours!));
  return { lane, reasons, hours: Number.isFinite(hours as number) ? hours : null, clash };
}

/**
 * Preferred: a small star, only on a genuine tie. Among Assign-lane trainers whose road miles are within 15 mi or 15%
 * of the closest one, the one with clearly fewer alerts (responsiveness: no daily update, clients left waiting) in the
 * last 30 days; reviews will add to this once they come in. No tie, or no clear winner: no star.
 */
export function preferred(rows: { id: string; lane: Lane; roadMiles: number | null; alerts: number; review?: number | null }[]): string | null {
  const a = rows.filter((r) => r.lane === "assign" && r.roadMiles != null);
  if (a.length < 2) return null;
  const best = Math.min(...a.map((r) => r.roadMiles!));
  const tied = a.filter((r) => r.roadMiles! <= best + Math.max(15, best * 0.15));
  if (tied.length < 2) return null;
  const score = (r: (typeof a)[number]) => r.alerts - (r.review != null ? (r.review - 4) * 0.5 : 0); // reviews: a small weight for now
  const sorted = [...tied].sort((x, y) => score(x) - score(y));
  return score(sorted[1]) - score(sorted[0]) >= 1 ? sorted[0].id : null;
}
