import { NextResponse } from "next/server";
import { isDemo, serviceClient } from "@/lib/supabase";
import { accessibleChat } from "@/lib/driveAccess";
import { createUploadSession, driveConfigured, ensureChatFolder } from "@/lib/drive";

const MAX = 5 * 1024 ** 3;

// Starts a direct-to-Drive upload into the chat's folder (created on first use).
export async function POST(req: Request) {
  if (isDemo() || !driveConfigured()) return NextResponse.json({ message: "Photo and video uploads aren't switched on yet." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 120), type = String(body.type || ""), size = Number(body.size);
  if (!name || !/^(image|video)\//.test(type)) return NextResponse.json({ message: "Only photos and videos." }, { status: 400 });
  if (!(size > 0) || size > MAX) return NextResponse.json({ message: "That file is too big (max 5 GB)." }, { status: 400 });
  const a = await accessibleChat(String(body.chatId || ""));
  if ("error" in a) return a.error;
  try {
    let folderId = a.c.drive_folder_id as string | null, folderUrl = a.c.drive_folder_url as string | null, warning: string | undefined;
    if (!folderId) {
      const f = await ensureChatFolder(a.c);
      folderId = f.id; folderUrl = f.url; warning = f.warning;
      await serviceClient().from("chats").update({ drive_folder_id: f.id, drive_folder_url: f.url }).eq("id", a.c.id);
    }
    const stored = `${new Date().toISOString().slice(0, 10)} ${Math.random().toString(36).slice(2, 8)} ${name}`;
    const origin = req.headers.get("origin") || (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    const uploadUrl = await createUploadSession({ name: stored, mimeType: type, size, parentId: folderId, origin });
    return NextResponse.json({ uploadUrl, storedName: stored, folderUrl, warning });
  } catch (e) { return NextResponse.json({ message: (e as Error).message }, { status: 502 }); }
}
