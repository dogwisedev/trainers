import "server-only";
import { serviceClient, isDemo } from "./supabase";

// Pickups and drop-offs: a dog's pickup is its booking's start date, the drop-off its end date.
export type Move = { id: string; kind: "pickup" | "dropoff"; date: string; dog: string; client: string; trainer: string };

/** Pickups and drop-offs with a date inside [from, to] (inclusive), soonest first. */
export async function movesBetween(from: string, to: string): Promise<Move[]> {
  if (isDemo()) return [];
  const sb = serviceClient();
  const [{ data: picks }, { data: drops }] = await Promise.all([
    sb.from("bookings").select("id, dog_name, client_name, start_date, trainers(name)").neq("status", "cancelled").gte("start_date", from).lte("start_date", to).order("start_date"),
    sb.from("bookings").select("id, dog_name, client_name, end_date, trainers(name)").neq("status", "cancelled").gte("end_date", from).lte("end_date", to).order("end_date")
  ]);
  type R = { id: string; dog_name: string | null; client_name: string; start_date?: string; end_date?: string; trainers: { name: string } | null };
  const row = (b: R, kind: Move["kind"], date: string): Move => ({ id: b.id, kind, date, dog: b.dog_name || "Dog", client: b.client_name, trainer: b.trainers?.name || "" });
  return [...((picks || []) as unknown as R[]).map((b) => row(b, "pickup", b.start_date!)), ...((drops || []) as unknown as R[]).map((b) => row(b, "dropoff", b.end_date!))]
    .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.dog.localeCompare(b.dog));
}
