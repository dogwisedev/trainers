import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { profileAccess } from "@/lib/pretrainingAccess";
import { createUploadSession, driveConfigured, ensureChatFolder } from "@/lib/drive";

const MAX = 30 * 1024 ** 2;

// Starts a direct-to-Drive upload of a vaccine record (photo or PDF) into the dog's chat folder. Client or admin.
export async function POST(req: Request) {
  if (!driveConfigured()) return NextResponse.json({ message: "Uploads aren't switched on yet." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 100), type = String(body.type || ""), size = Number(body.size);
  if (!name || !/^(image\/|application\/pdf$)/.test(type)) return NextResponse.json({ message: "Send a photo or a PDF of the vaccine record." }, { status: 400 });
  if (!(size > 0) || size > MAX) return NextResponse.json({ message: "That file is too big (max 30 MB)." }, { status: 400 });
  const a = await profileAccess(String(body.chatId || ""));
  if (!a || !a.edit) return NextResponse.json({ message: "You can't upload here." }, { status: 403 });
  if (a.chat.status !== "open") return NextResponse.json({ message: "This chat is closed." }, { status: 409 });
  try {
    let folderId = a.chat.drive_folder_id;
    if (!folderId) {
      const f = await ensureChatFolder(a.chat);
      folderId = f.id;
      await serviceClient().from("chats").update({ drive_folder_id: f.id, drive_folder_url: f.url }).eq("id", a.chat.id);
    }
    const stored = `Vaccines ${new Date().toISOString().slice(0, 10)} ${Math.random().toString(36).slice(2, 8)} ${name}`;
    const origin = req.headers.get("origin") || (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    const uploadUrl = await createUploadSession({ name: stored, mimeType: type, size, parentId: folderId, origin });
    return NextResponse.json({ uploadUrl, storedName: stored });
  } catch (e) { return NextResponse.json({ message: (e as Error).message }, { status: 502 }); }
}
