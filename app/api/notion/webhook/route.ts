import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { serviceClient } from "@/lib/supabase";
import { handleNotionEvent, type NotionEvent } from "@/lib/notionAlert";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Notion → app: the "Dogwise Buzz" integration's webhook (Notion → integration → Webhooks), events page.created and
// page.properties_updated. Back Office Workstream changes become Buzz posts (lib/notionAlert.ts).
// Setting it up, Notion sends one request with a verification_token: the app keeps it (app_state notion_verification_token)
// and shows it on /api/buzz/test, to paste into Notion's Verify box and into Vercel as NOTION_WEBHOOK_TOKEN. Every event after
// that is signed with it (X-Notion-Signature: sha256=<HMAC of the raw body>), and anything unsigned is refused.

const signedByNotion = (body: string, header: string | null, token: string) => {
  if (!header?.startsWith("sha256=")) return false;
  const want = Buffer.from(`sha256=${createHmac("sha256", token).update(body).digest("hex")}`), got = Buffer.from(header.toLowerCase());
  return want.length === got.length && timingSafeEqual(want, got);
};

export async function POST(req: Request) {
  const body = await req.text();
  let j: Record<string, unknown>;
  try { j = JSON.parse(body); } catch { return NextResponse.json({ error: "not JSON" }, { status: 400 }); }

  // The one-time setup request: a body with a verification_token and no event in it (whatever its headers say). Keep the
  // token for the admin to copy from /api/buzz/test (it does nothing until it's in Vercel too), and answer 200 as Notion needs.
  const vt = typeof j.verification_token === "string" ? j.verification_token : null;
  if (vt && !j.type && !j.entity) {
    const { error } = await serviceClient().from("app_state").upsert({ key: "notion_verification_token", value: vt, updated_at: new Date().toISOString() });
    console.log("notion webhook: verification token received", error ? `(couldn't save: ${error.message})` : "(see /api/buzz/test)");
    return NextResponse.json({ ok: true });
  }

  const token = (process.env.NOTION_WEBHOOK_TOKEN || "").trim();
  if (!token || !signedByNotion(body, req.headers.get("x-notion-signature"), token)) {
    // Kept so /api/buzz/test can show what arrived (Notion's events carry ids, not content)
    await serviceClient().from("app_state").upsert({ key: "notion_last_refused", value: JSON.stringify({ at: new Date().toISOString(), why: token ? "bad signature" : "NOTION_WEBHOOK_TOKEN isn't set", signed: !!req.headers.get("x-notion-signature"), body: body.slice(0, 800) }), updated_at: new Date().toISOString() });
    return token ? NextResponse.json({ error: "bad signature" }, { status: 401 }) : NextResponse.json({ error: "NOTION_WEBHOOK_TOKEN isn't set" }, { status: 503 });
  }

  let result: string;
  try { result = await handleNotionEvent(j as unknown as NotionEvent); }
  catch (e) { result = `error: ${(e as Error).message}`; console.error("notion webhook", (e as Error).message); }
  if (result !== "no watched field changed" && !result.startsWith("ignored")) console.log("notion webhook", j.type, (j.entity as { id?: string } | undefined)?.id, result);
  // Always 200 once signed: Notion retries failures for hours, and a post that didn't go isn't worth that
  return NextResponse.json({ ok: true, result });
}
