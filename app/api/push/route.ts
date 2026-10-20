import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { serviceClient } from "@/lib/supabase";
import { pushToUsers } from "@/lib/push";

// This phone turned notifications on (POST) or off (DELETE). POST with {test:true} sends a test notification.
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v || v.demo) return NextResponse.json({ ok: false, message: "Sign in first." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (b.test) { const n = await pushToUsers([v.userId], { title: "Notifications are on", body: "You'll get new messages, bookings and forms here.", url: "/", tag: "test" }); return NextResponse.json({ ok: n > 0 }); }
  const s = b.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
  if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) return NextResponse.json({ ok: false, message: "Bad subscription." }, { status: 400 });
  const { error } = await serviceClient().from("push_subscriptions").upsert({ endpoint: s.endpoint, user_id: v.userId, p256dh: s.keys.p256dh, auth: s.keys.auth, device: String(req.headers.get("user-agent") || "").slice(0, 200) });
  return NextResponse.json({ ok: !error, message: error?.message });
}
export async function DELETE(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (b.endpoint) await serviceClient().from("push_subscriptions").delete().eq("endpoint", b.endpoint).eq("user_id", v.userId);
  return NextResponse.json({ ok: true });
}
