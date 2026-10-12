import { NextResponse } from "next/server";
import { isDemo, serviceClient } from "@/lib/supabase";
import { accessibleBooking } from "@/lib/driveAccess";
import { createUploadSession, driveConfigured, ensureBookingFolder } from "@/lib/drive";

const MAX = 5 * 1024 ** 3;
const OK_TYPE = /^(image|video)\/|^application\/pdf$/;
const SLOTS = ["training", "homework", "health"];

// Starts a direct-to-Drive upload into the booking's folder.
export async function POST(req: Request) {
  if (isDemo() || !driveConfigured()) return NextResponse.json({ message: "Video and photo uploads aren't switched on yet." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 120), type = String(body.type || ""), size = Number(body.size), slot = String(body.slot || "");
  if (!name || !OK_TYPE.test(type) || !SLOTS.includes(slot)) return NextResponse.json({ message: "Only photos and videos." }, { status: 400 });
  if (!(size > 0) || size > MAX) return NextResponse.json({ message: "That file is too big (max 5 GB)." }, { status: 400 });
  const a = await accessibleBooking(String(body.bookingId || ""));
  if ("error" in a) return a.error;
  try {
    let folderId = a.b.drive_folder_id as string | null, warning: string | undefined;
    if (!folderId) {
      const f = await ensureBookingFolder(a.b);
      folderId = f.id; warning = f.warning;
      await serviceClient().from("bookings").update({ drive_folder_id: f.id, drive_folder_url: f.url }).eq("id", a.b.id);
    }
    const stored = `${new Date().toISOString().slice(0, 10)} ${slot} ${Math.random().toString(36).slice(2, 8)} ${name}`;
    const origin = req.headers.get("origin") || (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    const uploadUrl = await createUploadSession({ name: stored, mimeType: type, size, parentId: folderId, origin });
    return NextResponse.json({ uploadUrl, storedName: stored, warning });
  } catch (e) { return NextResponse.json({ message: (e as Error).message }, { status: 502 }); }
}
