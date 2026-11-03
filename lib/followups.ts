import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { hubspotConfigured, optionValue, propDefs, readDeals, updateDeal } from "./hubspot";
import { FOLLOWUP_PROPS, syncMoney } from "./money";
import { raiseIncident, resolveIncidents } from "./incidents";
import { todayIso } from "./dates";
import { postSystemMessage } from "./chat";

// Follow-up sessions (3 per program; table followups, migration 043).
//  Client: after the handover, "Book your follow-up" in the chat → a request with preferred days (status requested).
//  Trainer: confirms one (or sets one up directly) with a date and time → HubSpot Follow Up Session #n, a message in the
//  chat, and a reminder the day before (a scheduled message). After it: the trainer logs it (Log a follow-up session),
//  which fills FUP #n Completed / Duration / Comments. A missed or cancelled session can be booked again.

export const SESSIONS = 3;
const DONE_PROPS = ["follow_up_session_completed", "n2nd_follow_up_session_completed", "n3rd_follow_up_session_completed"];
const DURATION_PROPS = ["fup__1_duration", "fup__2_duration", "fup__3_duration"];
const COMMENT_PROPS = ["did_fup__1_happen__comments", "did_fup__2_happen__comments", "did_fup__3_happen__comments"];
const LIVE = ["requested", "confirmed", "done"];

export type Followup = { id: string; booking_id: string; chat_id: string | null; n: number; status: string; requested_by: string | null; options: { day: string; part: string }[]; note: string | null; at: string | null; reminder_id: string | null; completed: boolean | null; duration_min: number | null; comments: string | null; reported_at: string | null };
export type FollowupState = { bookingId: string; dog: string; trainer: string; trainerId: string; dealId: string | null; handedOver: boolean; sessions: Followup[]; nextN: number | null };

/** Everything about one booking's follow-ups. */
export async function followupState(bookingId: string, sb: SupabaseClient = serviceClient()): Promise<FollowupState | null> {
  const { data: b } = await sb.from("bookings").select("*, trainers(name)").eq("id", bookingId).maybeSingle();
  const bk = b as unknown as { id: string; dog_name: string | null; trainer_id: string; followup_trainer_id?: string | null; hubspot_deal_id: string | null; status: string; trainers: { name: string } | null } | null;
  if (!bk || bk.status === "cancelled") return null;
  // A separate follow-up trainer (migration 046) books, runs and logs the follow-ups
  const fuId = bk.followup_trainer_id || null;
  const { data: fuT } = fuId ? await sb.from("trainers").select("name").eq("id", fuId).maybeSingle() : { data: null };
  const [{ data: rows, error }, { data: hand }] = await Promise.all([
    sb.from("followups").select("*").eq("booking_id", bookingId).order("n").order("created_at"),
    sb.from("reports").select("submitted_at").eq("booking_id", bookingId).eq("kind", "handover").not("submitted_at", "is", null).limit(1)
  ]);
  const sessions = error ? [] : ((rows || []) as Followup[]);
  const used = new Set(sessions.filter((s) => LIVE.includes(s.status)).map((s) => s.n));
  const nextN = [1, 2, 3].find((n) => !used.has(n)) ?? null;
  return { bookingId, dog: bk.dog_name || "your dog", trainer: (fuId && fuT?.name) || bk.trainers?.name || "your trainer", trainerId: fuId || bk.trainer_id, dealId: bk.hubspot_deal_id, handedOver: !!hand?.length, sessions, nextN };
}

/** The booking a client's chat is about, for follow-ups: the latest one on the deal that isn't cancelled. */
export async function bookingForChat(dealKey: string, sb: SupabaseClient = serviceClient()): Promise<string | null> {
  const q = /^\d+$/.test(dealKey) ? sb.from("bookings").select("id").eq("hubspot_deal_id", dealKey) : sb.from("bookings").select("id").eq("id", dealKey);
  const { data } = await q.neq("status", "cancelled").order("end_date", { ascending: false }).limit(1).maybeSingle();
  return data?.id || null;
}

const dateMs = (iso: string) => String(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
/** HubSpot: Follow Up Session #n = that date (or cleared), and the pay side catches up straight away. */
export async function writeSessionDate(dealId: string | null, n: number, dayIso: string | null, sb: SupabaseClient = serviceClient()) {
  if (!dealId || !/^\d+$/.test(dealId) || !hubspotConfigured()) return;
  await updateDeal(dealId, { [FOLLOWUP_PROPS[n - 1]]: dayIso ? dateMs(dayIso) : "" });
  await syncMoney({ dealIds: [dealId], sb }).catch(() => null);
}
/** HubSpot: FUP #n Completed / Duration / Comments; and Client Status "Completed with Follow up" once one has happened. */
export async function writeSessionReport(dealId: string | null, n: number, completed: boolean, minutes: number | null, comments: string) {
  if (!dealId || !/^\d+$/.test(dealId) || !hubspotConfigured()) return;
  const defs = await propDefs("deals"), props: Record<string, string> = {};
  const yes = optionValue(defs.get(DONE_PROPS[n - 1]), completed ? "Yes" : "No"); if (yes) props[DONE_PROPS[n - 1]] = yes;
  if (minutes != null && defs.has(DURATION_PROPS[n - 1])) props[DURATION_PROPS[n - 1]] = String(minutes);
  if (comments && defs.has(COMMENT_PROPS[n - 1])) props[COMMENT_PROPS[n - 1]] = comments.slice(0, 2000);
  if (completed) {
    const cur = (await readDeals([dealId], ["client_status"]).catch(() => new Map())).get(dealId) || {};
    if (!/^(cancelled|refunded|after graduation support|completed with follow up)$/i.test(String(cur.client_status || "").trim())) { const v = optionValue(defs.get("client_status"), "Completed with Follow up"); if (v) props.client_status = v; }
  }
  if (Object.keys(props).length) await updateDeal(dealId, props);
}

/**
 * Background (with the 10-minute chat check):
 *  - once a handover report is in, a one-time message in the client's chat: "your program includes 3 follow-up sessions";
 *  - a request the trainer hasn't confirmed in 24 hours → a To do for the office;
 *  - a confirmed session that ended 2+ days ago with nothing logged → a To do for the office.
 */
export async function followupChecks(now = new Date(), sb: SupabaseClient = serviceClient()) {
  const out = { nudged: 0, raised: 0, errors: [] as string[] };
  // 1) The one-time message after the handover (the last 21 days only)
  const since = new Date(now.getTime() - 21 * 864e5).toISOString();
  const { data: hand } = await sb.from("reports").select("booking_id, submitted_at, bookings!booking_id(hubspot_deal_id, dog_name, status)").eq("kind", "handover").gte("submitted_at", since);
  for (const h of (hand || []) as unknown as { booking_id: string; bookings: { hubspot_deal_id: string | null; dog_name: string | null; status: string } | null }[]) {
    const key = h.bookings?.hubspot_deal_id || h.booking_id;
    if (!h.bookings || h.bookings.status === "cancelled") continue;
    const { data: chat, error } = await sb.from("chats").select("id, status, quiet_at, followup_nudged_at").eq("deal_key", key).maybeSingle();
    if (error) { if (/followup_nudged_at|schema cache/i.test(error.message)) return out; continue; } // before migration 043
    if (!chat || chat.status !== "open" || chat.quiet_at || chat.followup_nudged_at) continue;
    const { data: claim } = await sb.from("chats").update({ followup_nudged_at: now.toISOString() }).eq("id", chat.id).is("followup_nudged_at", null).select("id");
    if (!claim?.length) continue;
    const dog = h.bookings.dog_name || "your dog";
    await postSystemMessage(chat.id, { kind: "system", body: `🎓 ${dog}'s training is complete! Your program includes ${SESSIONS} follow-up sessions with your trainer. Whenever you're ready, tap "Book your follow-up" at the top of this chat and pick a few days that suit you.` }).catch(() => {});
    out.nudged++;
  }
  // 2) and 3) To do for the office when a follow-up is stuck
  const { data: rows, error } = await sb.from("followups").select("id, booking_id, n, status, at, created_at, reported_at, bookings!booking_id(dog_name, client_name, trainers(name))").in("status", ["requested", "confirmed"]);
  if (error) return out;
  for (const f of (rows || []) as unknown as (Followup & { created_at: string; bookings: { dog_name: string | null; client_name: string; trainers: { name: string } | null } | null })[]) {
    const who = `${f.bookings?.dog_name || "Dog"} (${f.bookings?.client_name || "client"}), ${f.bookings?.trainers?.name || "trainer"}`;
    if (f.status === "requested" && now.getTime() - Date.parse(f.created_at) > 24 * 3600e3)
      { if (await raiseIncident({ kind: "followup_request", title: who, ref: `followup:${f.id}`, bookingId: f.booking_id, urgent: false, detail: `${who}: the client asked for follow-up session ${f.n} over a day ago and the trainer hasn't confirmed a time.` }, sb)) out.raised++; }
    if (f.status === "confirmed" && f.at && !f.reported_at && now.getTime() - Date.parse(f.at) > 2 * 864e5)
      { if (await raiseIncident({ kind: "followup_report", title: who, ref: `followup-report:${f.id}`, bookingId: f.booking_id, urgent: false, detail: `${who}: follow-up session ${f.n} was ${f.at.slice(0, 10)} and the trainer hasn't logged it yet.` }, sb)) out.raised++; }
  }
  return out;
}

/** A request confirmed or a session logged: its To do for the office goes. */
export const clearFollowupTodos = (id: string, sb?: SupabaseClient) => Promise.all([
  resolveIncidents({ kinds: ["followup_request"], ref: `followup:${id}` }, "automatic", "Confirmed", sb),
  resolveIncidents({ kinds: ["followup_report"], ref: `followup-report:${id}` }, "automatic", "Logged", sb)
]).catch(() => null);
export { todayIso };
