import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";

// Trips a trainer drives (pickup, drop-off, follow-up session): for mileage pay and their own records.
export type TripKind = "pickup" | "dropoff" | "followup";
export type TripRow = { id: string; trainer_id: string; booking_id: string | null; kind: TripKind; trip_date: string; miles: number; notes: string | null; created_by: string | null; bookings?: { dog_name: string | null; client_name: string } | null };

export const validMiles = (v: unknown) => { const n = Number(String(v ?? "").trim()); return String(v ?? "").trim() !== "" && n >= 0 && n <= 2000 ? Math.round(n * 10) / 10 : null; };

/** The pickup (intake) or drop-off (handover) form's miles: one trip per form, updated if the form changes. */
export async function saveFormTrip(o: { reportId: string; trainerId: string; bookingId: string; kind: "pickup" | "dropoff"; date: string; miles: unknown; route?: string; by: string }, sb: SupabaseClient = serviceClient()) {
  const miles = validMiles(o.miles);
  if (miles === null || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return;
  const { error } = await sb.from("trips").upsert({
    report_id: o.reportId, trainer_id: o.trainerId, booking_id: o.bookingId, kind: o.kind, trip_date: o.date, miles,
    notes: (o.route || "").slice(0, 500) || null, created_by: o.by, updated_at: new Date().toISOString()
  }, { onConflict: "report_id" });
  if (error) console.error("trip", error.message); // never block a form over mileage
}

export async function tripsFor(o: { trainerId?: string; bookingId?: string; from?: string }, sb: SupabaseClient = serviceClient()): Promise<TripRow[]> {
  let q = sb.from("trips").select("*, bookings(dog_name, client_name)").order("trip_date", { ascending: false }).limit(500);
  if (o.trainerId) q = q.eq("trainer_id", o.trainerId);
  if (o.bookingId) q = q.eq("booking_id", o.bookingId);
  if (o.from) q = q.gte("trip_date", o.from);
  const { data } = await q;
  return (data || []) as TripRow[];
}
