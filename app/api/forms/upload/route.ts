import { NextResponse } from "next/server";
import { contactFromToken } from "@/lib/clientForms";
import { createUploadSession, driveConfigured, ensureClientFolder } from "@/lib/drive";
import { readContacts } from "@/lib/hubspot";

const MAX = 30 * 1024 ** 2;
// The client's before-training link: starts a direct-to-Drive upload of a vaccine record (photo or PDF) into their folder.
export async function POST(req: Request) {
  if (!driveConfigured()) return NextResponse.json({ message: "Uploads aren't switched on yet." }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const id = contactFromToken(String(b.token || ""));
  if (!id) return NextResponse.json({ message: "This link isn't valid." }, { status: 403 });
  const name = String(b.name || "").trim().slice(0, 100), type = String(b.type || ""), size = Number(b.size);
  if (!name || !/^(image\/|application\/pdf$)/.test(type)) return NextResponse.json({ message: "Send a photo or a PDF of the vaccine record." }, { status: 400 });
  if (!(size > 0) || size > MAX) return NextResponse.json({ message: "That file is too big (max 30 MB)." }, { status: 400 });
  try {
    const c = (await readContacts([id], ["firstname", "lastname"])).get(id);
    const folder = await ensureClientFolder(id, [c?.firstname, c?.lastname].filter(Boolean).join(" "));
    const stored = `Vaccines ${new Date().toISOString().slice(0, 10)} ${Math.random().toString(36).slice(2, 8)} ${name}`;
    const origin = req.headers.get("origin") || (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    const uploadUrl = await createUploadSession({ name: stored, mimeType: type, size, parentId: folder.id, origin });
    return NextResponse.json({ uploadUrl, storedName: stored, folderId: folder.id });
  } catch (e) { return NextResponse.json({ message: (e as Error).message }, { status: 502 }); }
}
