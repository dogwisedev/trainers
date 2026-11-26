"use server";
// Changing how long a dog stays, from the dog page (admins only; migration 070):
//  - Extend: a new drop-off date, written to HubSpot too. Paid at the trainer's usual day rate, or "Pro bono": the dog is
//    tracked and the kennel is taken, but the extra days aren't paid.
//  - Finished early: the dog went home before the end. Not a cancellation: nothing to HubSpot's Client Status, nothing for
//    Sean. The admin chooses "pay the days with the trainer" or "no payment", and the payslip follows.
//  - Remove a booking made by mistake: before pickup only. No HubSpot change, no alert, no client email; the chat goes to
//    the trainer who still has the dog, and the other trainer's calendar is cleared if the box is ticked.
// (Cancelling mid-program asks the same pay question: cancelTrainingAction in app/actions.ts.)
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audited } from "@/lib/audit";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient, serviceClient } from "@/lib/supabase";
import { addDays, daysBetween, short, todayIso } from "@/lib/dates";
import { datesFromHubspot, dealDateProps, hsDate, hubspotConfigured, readDeals, updateDeal } from "@/lib/hubspot";
import { MAX_EXTRA } from "@/lib/hubspotDates";
import { notifyBookings, notifySummary } from "@/lib/bookingEmail";

export type StayResult = { ok: boolean; message: string };
const DEMO: StayResult = { ok: false, message: "Demo mode: nothing saves." };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const NEEDS_070 = /left_on|end_kind|end_pay|unpaid_days|ended_by|ended_at|schema cache/i;
const dateMs = (iso: string) => String(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));

async function admin() {
  const v = await getViewer();
  if (!v || v.role !== "admin") throw new Error("Admins only.");
  return v;
}
type Row = { id: string; trainer_id: string; client_name: string; dog_name: string | null; start_date: string; end_date: string; weeks: number | null; extra_days: number | null; status: string;
  hubspot_deal_id: string | null; unpaid_days?: number | null; picked_up_at?: string | null; trainers: { name: string; capacity: number | null } | null };
async function load(sb: SupabaseClient, id: string): Promise<Row | null> {
  const { data } = await sb.from("bookings").select("*, trainers(name, capacity)").eq("id", id).maybeSingle();
  return (data as unknown as Row) || null;
}

/** HubSpot's end date is when the LAST dog on the deal goes home (lib/hubspotDates.ts). Writes it when this change moves it.
 *  Returns a note for the person, or throws when HubSpot drives the dates and couldn't be updated (so the two never disagree). */
async function writeDealEnd(sb: SupabaseClient, b: Row, newEnd: string): Promise<string> {
  const deal = b.hubspot_deal_id;
  if (!deal || !/^\d+$/.test(deal) || !hubspotConfigured()) return "";
  try {
    const props = await dealDateProps();
    if (!props.end) return " HubSpot has no end date on deals, so nothing was written there.";
    const { data } = await sb.from("bookings").select("id, end_date").eq("hubspot_deal_id", deal).neq("status", "cancelled");
    const ends = ((data || []) as { id: string; end_date: string }[]).map((x) => (x.id === b.id ? newEnd : x.end_date));
    const last = ends.reduce((m, x) => (x > m ? x : m), newEnd);
    const now = hsDate((await readDeals([deal], [props.end.name])).get(deal)?.[props.end.name]);
    if (now === last) return "";
    await updateDeal(deal, { [props.end.name]: props.end.type === "date" ? last : dateMs(last) });
    return ` HubSpot's end date is now ${short(last)}.`;
  } catch (e) {
    if (datesFromHubspot()) throw new Error(`HubSpot couldn't be updated, so nothing was changed: ${(e as Error).message}`);
    return ` HubSpot wasn't updated (${(e as Error).message}): change the end date on the deal.`;
  }
}

/** A payslip already approved that pays this dog for days on or after `from`: the one case a person has to correct by hand. */
async function paidPast(sb: SupabaseClient, bookingId: string, from: string): Promise<string> {
  try {
    const { data } = await sb.from("payslip_lines").select("payslips!inner(status, pay_runs!inner(period_end, paid_date))").eq("booking_id", bookingId).eq("kind", "training");
    const hit = ((data || []) as unknown as { payslips: { status: string; pay_runs: { period_end: string; paid_date: string } } }[]).filter((l) => l.payslips?.status === "approved" && l.payslips.pay_runs?.period_end >= from);
    return hit.length ? ` Check pay: a payslip already approved (paid ${short(hit[0].payslips.pay_runs.paid_date)}) covers days from ${short(from)} on. Anita needs to correct it.` : "";
  } catch { return ""; }
}

/** Extend a stay: a new drop-off date. `proBono`: the added days are tracked but not paid. */
export async function extendStayAction(id: string, newEnd: string, proBono: boolean): Promise<StayResult> {
  return audited("extendStayAction", { id, newEnd, proBono: proBono ? "pro bono" : "paid" }, async () => {
    if (isDemo()) return DEMO;
    try {
      const v = await admin();
      const sb = serverClient(), b = await load(sb, id);
      if (!b || b.status === "cancelled") return { ok: false, message: "Booking not found, or it's cancelled." };
      if (!ISO.test(newEnd) || newEnd <= b.end_date) return { ok: false, message: `Pick a drop-off date after ${short(b.end_date)}.` };
      const weeks = b.weeks || Math.max(1, Math.floor(daysBetween(b.start_date, b.end_date) / 7));
      const added = daysBetween(b.end_date, newEnd), extra = daysBetween(b.start_date, newEnd) - weeks * 7;
      if (extra > MAX_EXTRA) return { ok: false, message: `That's more than ${MAX_EXTRA} days past the ${weeks}-week program. If the program itself is longer, change the program on the deal.` };
      const unpaid = Math.min(MAX_EXTRA, Math.max(0, Number(b.unpaid_days) || 0) + (proBono ? added : 0));
      // Room? Only a warning: the dog is already there, and the person extending knows the trainer
      const { data: others } = await sb.from("bookings").select("start_date, end_date").eq("trainer_id", b.trainer_id).neq("status", "cancelled").neq("id", b.id).lt("start_date", newEnd).gt("end_date", b.end_date);
      const cap = Number(b.trainers?.capacity) || 0;
      let fullOn = "";
      for (let d = b.end_date; cap > 0 && d < newEnd && !fullOn; d = addDays(d, 1)) if (((others || []) as { start_date: string; end_date: string }[]).filter((o) => o.start_date <= d && d < o.end_date).length + 1 > cap) fullOn = d;
      const hs = await writeDealEnd(sb, b, newEnd);
      const { error } = await sb.from("bookings").update({ end_date: newEnd, extra_days: Math.max(0, extra), ...(proBono ? { unpaid_days: unpaid } : {}) }).eq("id", id);
      if (error) return { ok: false, message: NEEDS_070.test(error.message) ? "Run migration 070 in Supabase first (pro bono days)." : error.message };
      revalidatePath("/", "layout");
      const sent = notifySummary(await notifyBookings(sb, [id], "changed"));
      const name = (b.trainers?.name || "the trainer").split(" ")[0];
      return { ok: true, message: `${b.dog_name || "The dog"} now goes home ${short(newEnd)}: ${added} more day${added === 1 ? "" : "s"}, ${proBono ? `pro bono (tracked, not on ${name}'s payslip)` : `paid at ${name}'s usual day rate`}.${hs}${sent}${fullOn ? ` Heads up: ${name} is over their kennels from ${short(fullOn)}.` : ""} (${v.name})` };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  });
}

/** The dog went home before the end of the program, and it isn't a cancellation. */
export async function finishEarlyAction(id: string, leftOn: string, pay: "days" | "none", note: string): Promise<StayResult> {
  return audited("finishEarlyAction", { id, leftOn, pay, note }, async () => {
    if (isDemo()) return DEMO;
    try {
      const v = await admin();
      const sb = serverClient(), b = await load(sb, id), today = todayIso();
      if (!b || b.status === "cancelled") return { ok: false, message: "Booking not found, or it's cancelled." };
      if (b.start_date > today && !b.picked_up_at) return { ok: false, message: "This training hasn't started yet: cancel it instead." };
      if (pay !== "days" && pay !== "none") return { ok: false, message: "Choose whether the trainer is paid for the days." };
      if (!ISO.test(leftOn) || leftOn < b.start_date || leftOn >= b.end_date) return { ok: false, message: `The day the dog left must be between ${short(b.start_date)} and ${short(addDays(b.end_date, -1))}.` };
      const weeks = b.weeks || Math.max(1, Math.floor(daysBetween(b.start_date, b.end_date) / 7));
      const days = daysBetween(b.start_date, leftOn);
      const hs = await writeDealEnd(sb, b, leftOn);
      const { error } = await sb.from("bookings").update({ end_date: leftOn, extra_days: Math.max(0, days - weeks * 7), unpaid_days: 0, left_on: leftOn, end_kind: "finished_early", end_pay: pay,
        ended_by: v.name, ended_at: new Date().toISOString(), ...(note.trim() ? { cancel_note: `Finished early. ${note.trim()}`.slice(0, 1000) } : {}) }).eq("id", id);
      if (error) return { ok: false, message: NEEDS_070.test(error.message) ? "Run migration 070 in Supabase first (ending a training early)." : error.message };
      revalidatePath("/", "layout");
      const sent = notifySummary(await notifyBookings(sb, [id], "changed"));
      const name = (b.trainers?.name || "the trainer").split(" ")[0];
      return { ok: true, message: `${b.dog_name || "The dog"} finished early on ${short(leftOn)}. ${pay === "days" ? `${name} is paid for the ${days} day${days === 1 ? "" : "s"} with them.` : `No payment to ${name} for these days.`}${hs}${sent}${await paidPast(sb, id, leftOn)}` };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  });
}

/** A booking made by mistake (the wrong trainer, booked twice): take it away quietly. Before pickup only. */
export async function removeMistakeAction(id: string, tellTrainer: boolean, why: string): Promise<StayResult> {
  return audited("removeMistakeAction", { id, tellTrainer: tellTrainer ? "calendar cleared" : "trainer not told", why }, async () => {
    if (isDemo()) return DEMO;
    try {
      await admin();
      if (why.trim().length < 5) return { ok: false, message: "Say in a few words what the mistake was: it's kept in the activity log." };
      const sb = serverClient(), svc = serviceClient(), b = await load(sb, id);
      if (!b) return { ok: false, message: "Booking not found." };
      if (b.picked_up_at || b.start_date <= todayIso()) return { ok: false, message: "This training has started, so it can't be removed as a mistake. Use Change trainer, or Cancel training." };
      const { count } = await svc.from("payslip_lines").select("id", { count: "exact", head: true }).eq("booking_id", id);
      if (count) return { ok: false, message: "This booking is on a payslip already, so it can't be removed. Ask Anita first." };
      const name = b.trainers?.name || "The trainer";
      // Their calendar: the cancellation email carries the calendar removal. Sent while the booking still exists.
      const sent = tellTrainer ? notifySummary(await notifyBookings(sb, [id], "cancelled")) : "";
      // The deal's chat goes to the trainer who still has the dog(s)
      let chatNote = "";
      if (b.hubspot_deal_id) {
        const { data: rest } = await svc.from("bookings").select("trainer_id, trainers(name)").eq("hubspot_deal_id", b.hubspot_deal_id).neq("status", "cancelled").neq("id", id).order("start_date");
        const keep = ((rest || []) as unknown as { trainer_id: string; trainers: { name: string } | null }[])[0];
        if (keep && keep.trainer_id !== b.trainer_id) {
          const { data: moved } = await svc.from("chats").update({ trainer_id: keep.trainer_id, trainer_name: keep.trainers?.name || null }).eq("deal_key", b.hubspot_deal_id).eq("status", "open").eq("trainer_id", b.trainer_id).select("id");
          if (moved?.length) chatNote = ` The chat is now with ${keep.trainers?.name || "the other trainer"}.`;
        } else if (!keep) chatNote = " No other booking is left on this deal: its chat stays open until you close it.";
      }
      const { error } = await svc.from("bookings").delete().eq("id", id);
      if (error) return { ok: false, message: error.message };
      await svc.from("chat_incidents").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: "automatic", resolved_note: "Booking removed (made by mistake)" }).eq("ref", `booking:${id}`).neq("status", "resolved").then(() => null, () => null);
      revalidatePath("/", "layout");
      return { ok: true, message: `Removed ${b.dog_name || "the dog"}'s booking with ${name}. Nothing was sent to HubSpot, the client or Sean.${chatNote}${tellTrainer ? sent || ` ${name.split(" ")[0]} was told.` : ` ${name.split(" ")[0]} wasn't told.`}` };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  });
}
