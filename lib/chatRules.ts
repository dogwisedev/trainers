// When does a chat need an admin's attention? Pure functions (no database), so they're easy to test and to adjust.
// Times are Eastern. The numbers below are the agreed defaults; change them here.
import { REPORT_TZ } from "./reports";

export const RULES = {
  trainerUpdateByHour: 20,        // trainer must have posted something by 8 pm Eastern on every day a dog is in care
  wakeFrom: 8, wakeTo: 21,        // "waking hours" for client waiting times: 8 am to 9 pm Eastern
  clientWaitingHours: 12,         // a client message with no reply after 12 waking hours is flagged
  pileUpCount: 3, pileUpWithinHours: 3,   // 3+ unanswered client messages within 3 hours is flagged straight away
  silentDaysToClose: 60,          // ~2 months with no messages and no dog in care: ready to close
  realertHours: 12,               // re-send the alert if nobody has taken it
  // Client emails: at most one per chat per day, only if something is still unread, and only in the daytime
  clientDigestMinUnreadMinutes: 90, clientDigestEveryHours: 24, clientDigestFromHour: 9, clientDigestToHour: 20,
};

export function etParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: REPORT_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute };
}

/** Hours between two moments that fall inside waking hours (Eastern). Checked in 5-minute steps; capped at 3 days. */
export function wakingHours(from: Date, to: Date): number {
  const end = Math.min(to.getTime(), from.getTime() + 3 * 86400000);
  let minutes = 0;
  for (let t = from.getTime(); t < end; t += 300000) {
    const h = etParts(new Date(t)).hour;
    if (h >= RULES.wakeFrom && h < RULES.wakeTo) minutes += Math.min(5, (end - t) / 60000);
  }
  return Math.round((minutes / 60) * 10) / 10;
}

export type BookingSpan = { start_date: string; end_date: string; status: string };
const inCareOn = (bs: BookingSpan[], date: string) => bs.some((b) => b.status !== "cancelled" && b.start_date <= date && date <= b.end_date);

/** After 8 pm Eastern, on a day a dog is in care, the trainer hasn't posted anything today. */
export function trainerSilent(now: Date, bookings: BookingSpan[], lastTrainerAt: string | null): boolean {
  const { date, hour } = etParts(now);
  if (hour < RULES.trainerUpdateByHour || !inCareOn(bookings, date)) return false;
  return !lastTrainerAt || etParts(new Date(lastTrainerAt)).date !== date;
}

/** The client's latest message has had no reply from the trainer or an admin for 12+ waking hours. */
export function clientWaiting(now: Date, lastClientAt: string | null, lastReplyAt: string | null): number | null {
  if (!lastClientAt) return null;
  const lc = new Date(lastClientAt);
  if (lastReplyAt && new Date(lastReplyAt) >= lc) return null;
  const h = wakingHours(lc, now);
  return h >= RULES.clientWaitingHours ? h : null;
}

/** 3+ client messages since the last reply, inside the last 3 hours. `times` are the client's unanswered messages. */
export function pileUp(now: Date, times: string[]): number | null {
  const recent = times.filter((t) => now.getTime() - new Date(t).getTime() <= RULES.pileUpWithinHours * 3600000);
  return recent.length >= RULES.pileUpCount ? recent.length : null;
}

/** ~2 months of silence and no dog in care now or later. Returns days of silence. */
export function readyToClose(now: Date, lastMessageAt: string | null, createdAt: string, bookings: BookingSpan[]): number | null {
  const today = etParts(now).date;
  if (bookings.some((b) => b.status !== "cancelled" && b.end_date >= today)) return null;
  const days = Math.floor((now.getTime() - new Date(lastMessageAt || createdAt).getTime()) / 86400000);
  return days >= RULES.silentDaysToClose ? days : null;
}

/** Should the client get a "you have new updates" email now? */
export function clientDigestDue(now: Date, o: { latestFromOthers: string | null; clientReadAt: string | null; notifiedAt: string | null }): boolean {
  if (!o.latestFromOthers) return false;
  const latest = new Date(o.latestFromOthers).getTime();
  if (o.clientReadAt && new Date(o.clientReadAt).getTime() >= latest) return false;                // they've seen it
  if (now.getTime() - latest < RULES.clientDigestMinUnreadMinutes * 60000) return false;           // give them time to open it first
  if (o.notifiedAt && now.getTime() - new Date(o.notifiedAt).getTime() < RULES.clientDigestEveryHours * 3600000) return false; // at most daily
  const h = etParts(now).hour;
  return h >= RULES.clientDigestFromHour && h < RULES.clientDigestToHour;                           // daytime only
}

export const INCIDENT_LABEL = {
  trainer_silent: "Trainer hasn't posted today", client_waiting: "Client waiting for a reply", client_pileup: "Client messages piling up",
  ready_to_close: "Ready to close", reopened: "Client started a new chat",
  intake_media_missing: "No pickup photos or video", handover_photo_missing: "No photo with the trainer",
  overbooked: "Trainer overbooked", length_changed: "Program length changed", booking_cancelled: "Training cancelled", hubspot_problem: "Check HubSpot"
} as const;
export type IncidentKind = keyof typeof INCIDENT_LABEL;
/** Incidents the chat check opens and clears by itself. The others are about forms, bookings or HubSpot. */
export const CHAT_KINDS: IncidentKind[] = ["trainer_silent", "client_waiting", "client_pileup", "ready_to_close", "reopened"];
