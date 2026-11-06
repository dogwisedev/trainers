import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { auditCall } from "@/lib/audit";
import { quoConfigured, sendText, toE164 } from "@/lib/quo";

export const dynamic = "force-dynamic";
// Signed in as an admin, open /api/quo/test?to=+15551234567 to send one test text from the Quo number and see
// exactly what Quo answered. Without ?to= it only shows whether Quo is set up.
export async function GET(req: Request) {
  const v = await getViewer().catch(() => null);
  if (!v || v.role !== "admin") return NextResponse.json({ error: "Sign in as an admin first." }, { status: 401 });
  const to = new URL(req.url).searchParams.get("to") || "";
  const setup = { configured: quoConfigured(), from: process.env.QUO_FROM || null, apiUrl: process.env.QUO_API_URL || "https://api.openphone.com/v1 (default)" };
  if (!to) return NextResponse.json({ ...setup, next: "Add ?to=+1XXXXXXXXXX (your mobile) to send a test text." });
  if (!toE164(to)) return NextResponse.json({ ...setup, error: `"${to}" isn't a US phone number.` }, { status: 400 });
  const result = await sendText(to, `Dogwise: test from the trainers app, sent ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET. If you can read this, texts work.`);
  await auditCall("quoTest", { to }, { name: v.name, role: v.role }, { ok: result.ok, error: result.error || null });
  return NextResponse.json({ ...setup, to: toE164(to), result }, { status: result.ok ? 200 : 502 });
}
