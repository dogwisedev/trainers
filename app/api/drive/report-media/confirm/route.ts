import { NextResponse } from "next/server";
import { findFile } from "@/lib/drive";
import { signMedia } from "@/lib/mediaSig";
import { accessibleBooking } from "@/lib/driveAccess";

// After an upload: finds the file in the booking's folder and returns its id plus a signed confirmation.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const a = await accessibleBooking(String(body.bookingId || ""));
  if ("error" in a) return a.error;
  if (!a.b.drive_folder_id) return NextResponse.json({ message: "No folder for this booking yet." }, { status: 400 });
  const id = await findFile(a.b.drive_folder_id, String(body.storedName || ""));
  if (!id) return NextResponse.json({ message: "The upload isn't in Drive yet. Try again in a moment." }, { status: 404 });
  return NextResponse.json({ id, sig: signMedia(id, a.b.id) });
}
