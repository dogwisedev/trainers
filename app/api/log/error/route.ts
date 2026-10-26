import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { auditCall } from "@/lib/audit";

// A screen crashed for someone (the "Something went wrong" page): log who, where and why, so it can be fixed.
export async function POST(req: Request) {
  const v = await getViewer().catch(() => null);
  const b = await req.json().catch(() => ({}));
  const s = (x: unknown, n = 200) => String(x ?? "").slice(0, n);
  await auditCall("screenError", { page: s(b.path, 160), ref: s(b.digest, 40), device: s(b.device, 90) },
    v ? undefined : { name: "Someone (not signed in)", role: "sign-in" }, { ok: false, error: s(b.message, 400) || "Unknown error" });
  return NextResponse.json({ ok: true });
}
