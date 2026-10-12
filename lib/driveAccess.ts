import "server-only";
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { serverClient } from "@/lib/supabase";

/** Booking the viewer may add media to: trainers only their own (row level security does the check), admins any. */
export async function accessibleBooking(bookingId: string) {
  const v = await getViewer();
  if (!v) return { error: NextResponse.json({ message: "Sign in again." }, { status: 401 }) } as const;
  const { data: b } = await serverClient().from("bookings").select("id, trainer_id, client_name, dog_name, drive_folder_id").eq("id", bookingId).maybeSingle();
  if (!b) return { error: NextResponse.json({ message: "Booking not found." }, { status: 404 }) } as const;
  return { v, b } as const;
}
