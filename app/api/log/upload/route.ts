import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { auditCall } from "@/lib/audit";

// The chat tells the activity log when an upload fails (or Drive sharing is off), with the phone, file and step,
// so a "my upload didn't work" can be checked against what actually happened.
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const s = (x: unknown, n = 160) => String(x ?? "").slice(0, n);
  const size = Number(b.size) || 0;
  await auditCall(b.warning ? "uploadWarning" : "uploadFailed", {
    chatId: s(b.chatId, 40), file: s(b.name, 120), type: s(b.type, 60) || "no type", size: size ? `${(size / 1048576).toFixed(1)} MB` : "",
    step: s(b.stage, 20), device: s(b.device, 90), signal: b.online === false ? "offline" : "online"
  }, undefined, { ok: false, error: s(b.error, 400) });
  return NextResponse.json({ ok: true });
}
