// Pickup and drop-off as confirmed events (migration 045). Pure, so the Dogs tabs, HubSpot and the trainer's card agree.
//  Picked up  = the trainer tapped "Picked up", or the intake form is in, or it started before CONFIRM_FROM (the past).
//  Dropped off = the trainer tapped "Dropped home", or the handover report is in, or it ended before CONFIRM_FROM.
export const CONFIRM_FROM = "2026-11-01";
type B = { start_date: string; end_date: string; status: string; picked_up_at?: string | null; dropped_off_at?: string | null };
export const pickedUp = (b: B, intakeIn = false) => b.status !== "cancelled" && (!!b.picked_up_at || intakeIn || b.start_date < CONFIRM_FROM);
export const droppedOff = (b: B, handoverIn = false) => b.status !== "cancelled" && (!!b.dropped_off_at || handoverIn || b.end_date < CONFIRM_FROM);
/** Past its day and still not confirmed. */
export const pickupOverdue = (b: B, today: string, intakeIn = false) => b.status !== "cancelled" && b.start_date < today && !pickedUp(b, intakeIn);
export const dropoffOverdue = (b: B, today: string, intakeIn = false, handoverIn = false) => b.status !== "cancelled" && b.end_date < today && pickedUp(b, intakeIn) && !droppedOff(b, handoverIn);

/** The trainer's time zone, from the state on their profile (Eastern if unknown): for the 5 PM check. */
const PT = ["CA", "WA", "OR", "NV"], MT = ["AZ", "CO", "UT", "NM", "MT", "WY", "ID"], CT = ["TX", "IL", "MN", "WI", "IA", "MO", "AR", "LA", "MS", "AL", "TN", "KY", "OK", "KS", "NE", "SD", "ND"];
export const trainerZone = (state: string | null | undefined) => { const s = String(state || "").trim().toUpperCase(); return s === "AZ" ? "America/Phoenix" : PT.includes(s) ? "America/Los_Angeles" : MT.includes(s) ? "America/Denver" : CT.includes(s) ? "America/Chicago" : s === "HI" ? "Pacific/Honolulu" : s === "AK" ? "America/Anchorage" : "America/New_York"; };
export const localParts = (tz: string, at = new Date()) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) }; };
