import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { isDemo } from "@/lib/supabase";
import { notifyKey, notifyMessage } from "@/lib/chatNotify";

export const maxDuration = 30;
// Called by the database the moment a chat message is saved (migration 033). The key lives in app_state,
// which only the server and the database can read. Notifies once: if the sender's app already did, this does nothing.
export async function POST(req: Request) {
  if (isDemo()) return NextResponse.json({ skipped: "demo" });
  const given = req.headers.get("x-notify-key") || "", key = await notifyKey();
  if (!key || given.length !== key.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const id = String(b.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  return NextResponse.json({ sent: await notifyMessage(id) });
}
