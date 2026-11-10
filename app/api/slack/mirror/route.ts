import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { mirrorEvent } from "@/lib/slackMirror";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
// Slack → app: the "Buzz Mirror" Slack app's events (message.channels, message.groups) for the channels it's invited to.
// Each person's message is copied to the matching Buzz channel (lib/slackMirror.ts). Signed with the app's Signing Secret
// (Vercel SLACK_MIRROR_SIGNING_SECRET). Slack's one-time URL check (url_verification) only echoes its challenge.

function signedBySlack(req: Request, body: string, secret: string) {
  const ts = req.headers.get("x-slack-request-timestamp") || "", sig = req.headers.get("x-slack-signature") || "";
  if (!ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const want = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function POST(req: Request) {
  const body = await req.text();
  let j: { type?: string; challenge?: string; event_id?: string; event?: unknown };
  try { j = JSON.parse(body); } catch { return NextResponse.json({ error: "not JSON" }, { status: 400 }); }
  if (j.type === "url_verification" && typeof j.challenge === "string") return NextResponse.json({ challenge: j.challenge });

  const secret = (process.env.SLACK_MIRROR_SIGNING_SECRET || "").trim();
  if (!secret) return NextResponse.json({ error: "SLACK_MIRROR_SIGNING_SECRET isn't set" }, { status: 503 });
  if (!signedBySlack(req, body, secret)) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let result: string;
  try { result = await mirrorEvent(j as Parameters<typeof mirrorEvent>[0]); }
  catch (e) { result = `error: ${(e as Error).message}`; console.error("slack mirror", (e as Error).message); }
  if (result !== "ignored" && result !== "not a person's message" && result !== "not a mirrored channel") console.log("slack mirror", result);
  // Always 200 once signed: Slack retries anything slower or failed, and the claim stops a double post
  return NextResponse.json({ ok: true, result });
}
