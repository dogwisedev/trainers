import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { checkRoot, driveConfigured, ensureFolder, rootFolderId, testAnyoneSharing } from "@/lib/drive";

// Admin-only: is Google Drive connected and ready for uploads?
export async function GET() {
  const v = await getViewer();
  if (!v || v.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!driveConfigured()) return NextResponse.json({ ok: false, hints: ["Not set up yet: add GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and DRIVE_ROOT_FOLDER_ID in Vercel, then redeploy."] });
  try {
    const root = await checkRoot();
    if (!root.ok) return NextResponse.json(root);
    const sharing = await testAnyoneSharing(await ensureFolder("Upload tests", rootFolderId()));
    return NextResponse.json({ ...root, sharing });
  }
  catch (e) { return NextResponse.json({ ok: false, hints: [(e as Error).message] }); }
}
