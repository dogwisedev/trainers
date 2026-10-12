import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { createUploadSession, driveConfigured, ensureFolder, rootFolderId } from "@/lib/drive";

const MAX = 5 * 1024 ** 3; // 5 GB
const OK_TYPE = /^(image|video)\/|^application\/pdf$/;

// Starts a direct-to-Drive upload. Test version: admins only, files land in "Upload tests".
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v || v.role !== "admin") return NextResponse.json({ message: "Admins only." }, { status: 403 });
  if (!driveConfigured()) return NextResponse.json({ message: "Google Drive isn't set up yet." }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const name = String(b.name || "").trim().slice(0, 200), type = String(b.type || ""), size = Number(b.size);
  if (!name || !OK_TYPE.test(type)) return NextResponse.json({ message: "Only photos, videos and PDFs." }, { status: 400 });
  if (!(size > 0) || size > MAX) return NextResponse.json({ message: "That file is too big (max 5 GB)." }, { status: 400 });
  try {
    const origin = req.headers.get("origin") || (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    const parentId = await ensureFolder("Upload tests", rootFolderId());
    const uploadUrl = await createUploadSession({ name: `${new Date().toISOString().slice(0, 10)} ${name}`, mimeType: type, size, parentId, origin });
    return NextResponse.json({ uploadUrl });
  } catch (e) { return NextResponse.json({ message: (e as Error).message }, { status: 502 }); }
}
