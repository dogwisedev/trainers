import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { raiseIncident, resolveIncidents } from "./incidents";
import { pushToTrainer } from "./push";
import { syncProgramStatus } from "./programSync";
import { CONFIRM_FROM, localParts, trainerZone } from "./moveRules";
import { todayIso } from "./dates";

// Pickup and drop-off as confirmed events (migration 045).
//  confirmMove: the trainer (or the office) says it happened → the booking is marked, its To do clears, HubSpot moves on.
//  moveChecks (every 10 minutes): a push at 5 PM in the trainer's time on the day if nothing's confirmed yet, a To do for the
//  office the morning after if still nothing, and those To do items clear themselves once it's confirmed (button or form).

export type Move = "pickup" | "dropoff";
const col = (m: Move) => (m === "pickup" ? { at: "picked_up_at", by: "picked_up_by", prompted: "pickup_prompted_at", kind: "pickup_unconfirmed" as const } : { at: "dropped_off_at", by: "dropped_off_by", prompted: "dropoff_prompted_at", kind: "dropoff_unconfirmed" as const });

/** Mark a pickup or drop-off as done (by a person, or by a form coming in). Idempotent: a second confirmation changes nothing. */
export async function confirmMove(bookingId: string, m: Move, by: string, sb: SupabaseClient = serviceClient()) {
  const c = col(m);
  const { data, error } = await sb.from("bookings").update({ [c.at]: new Date().toISOString(), [c.by]: by }).eq("id", bookingId).is(c.at, null).select("hubspot_deal_id");
  if (error) { if (/picked_up_at|dropped_off_at|schema cache/i.test(error.message)) return { ok: false, message: "Confirming isn't switched on yet (migration 045)." }; return { ok: false, message: error.message }; }
  await resolveIncidents({ kinds: [c.kind], ref: `${m}:${bookingId}` }, by, m === "pickup" ? "Picked up" : "Dropped home", sb).catch(() => null);
  const deal = (data || [])[0]?.hubspot_deal_id as string | undefined;
  if (deal) await syncProgramStatus(sb, new Date(), [deal]).catch(() => null); // HubSpot moves on now, not in 30 minutes
  return { ok: true, message: m === "pickup" ? "Picked up: thanks!" : "Home: thanks!" };
}

export async function moveChecks(now = new Date(), sb: SupabaseClient = serviceClient()) {
  const out = { pushed: 0, raised: 0, cleared: 0, errors: [] as string[] };
  const today = todayIso();
  const { data, error } = await sb.from("bookings").select("id, dog_name, client_name, start_date, end_date, status, trainer_id, picked_up_at, dropped_off_at, pickup_prompted_at, dropoff_prompted_at, trainers(name, state)")
    .neq("status", "cancelled").or(`and(picked_up_at.is.null,start_date.gte.${CONFIRM_FROM},start_date.lte.${today}),and(dropped_off_at.is.null,end_date.gte.${CONFIRM_FROM},end_date.lte.${today})`).limit(300);
  if (error) { if (!/picked_up_at|schema cache/i.test(error.message)) out.errors.push(error.message); return out; }
  type Row = { id: string; dog_name: string | null; client_name: string; start_date: string; end_date: string; trainer_id: string; picked_up_at: string | null; dropped_off_at: string | null; pickup_prompted_at: string | null; dropoff_prompted_at: string | null; trainers: { name: string; state: string | null } | null };
  for (const b of (data || []) as unknown as Row[]) {
    const dog = b.dog_name || "the dog", local = localParts(trainerZone(b.trainers?.state), now);
    for (const m of ["pickup", "dropoff"] as Move[]) {
      const c = col(m), day = m === "pickup" ? b.start_date : b.end_date, done = m === "pickup" ? b.picked_up_at : b.dropped_off_at, prompted = m === "pickup" ? b.pickup_prompted_at : b.dropoff_prompted_at;
      if (done || day < CONFIRM_FROM || (m === "dropoff" && !b.picked_up_at)) continue;
      // 5 PM on the day, in the trainer's time: one push
      if (day === local.date && local.hour >= 17 && !prompted) {
        const { data: claim } = await sb.from("bookings").update({ [c.prompted]: now.toISOString() }).eq("id", b.id).is(c.prompted, null).select("id");
        if (claim?.length) { await pushToTrainer(b.trainer_id, { title: m === "pickup" ? `Did you pick up ${dog} today?` : `Is ${dog} home?`, body: "Tap to confirm, or say it's moved.", url: "/t", tag: `${m}-${b.id}` }).catch(() => null); out.pushed++; }
      }
      // The morning after (Eastern), still nothing: the office is told
      if (day < today && await raiseIncident({ kind: c.kind, ref: `${m}:${b.id}`, bookingId: b.id, title: `${dog} (${b.client_name}), ${b.trainers?.name || "trainer"}`, urgent: false,
        detail: `${m === "pickup" ? "Pickup" : "Drop-off"} on ${day} hasn't been confirmed by ${b.trainers?.name || "the trainer"} (no button, no ${m === "pickup" ? "intake form" : "handover report"}).` }, sb)) out.raised++;
    }
  }
  return out;
}
