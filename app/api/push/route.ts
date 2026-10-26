import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { serviceClient } from "@/lib/supabase";
import { pushTestDetailed, pushToUsers } from "@/lib/push";
import { auditCall } from "@/lib/audit";

// This phone turned notifications on (POST) or off (DELETE). POST with {test:true} sends a test notification.
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v || v.demo) return NextResponse.json({ ok: false, message: "Sign in first." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (b.diagnose) return NextResponse.json({ ok: true, serverKey: (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").slice(0, 12), privateKeySet: !!process.env.VAPID_PRIVATE_KEY, results: await pushTestDetailed(v.userId, b.endpoint) });
  if (b.test) await auditCall("pushTest", {});
  if (b.test) { const n = await pushToUsers([v.userId], { title: "Notifications are on", body: "You'll get new messages, bookings and forms here.", url: "/", tag: "test" }); return NextResponse.json({ ok: n > 0 }); }
  const s = b.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
  if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) return NextResponse.json({ ok: false, message: "Bad subscription." }, { status: 400 });
  await auditCall("pushOn", { device: String(req.headers.get("user-agent") || "").replace(/^Mozilla\/5\.0 \(([^)]*)\).*/, "$1").slice(0, 80) });
  const svc = serviceClient(), host = (req.headers.get("host") || "").toLowerCase(), ua = String(req.headers.get("user-agent") || "").slice(0, 200);
  const { error } = await svc.from("push_subscriptions").upsert({ endpoint: s.endpoint, user_id: v.userId, p256dh: s.keys.p256dh, auth: s.keys.auth, device: `${host} | ${ua}`.slice(0, 200) }, { onConflict: "endpoint" });
  // After the move to the app's own address (APP_HOST): this phone's older install on the old address stops getting
  // notifications, or every notification would arrive twice.
  const canonical = (process.env.APP_HOST || "").trim().toLowerCase();
  if (!error && canonical && host === canonical) {
    const { data: mine } = await svc.from("push_subscriptions").select("endpoint, device").eq("user_id", v.userId).neq("endpoint", s.endpoint);
    const old = ((mine || []) as { endpoint: string; device: string | null }[]).filter((x) => {
      const [h, rest] = (x.device || "").includes(" | ") ? (x.device || "").split(" | ") : ["", x.device || ""];
      return !!rest && ua.startsWith(rest) && h !== canonical;
    }).map((x) => x.endpoint);
    if (old.length) await svc.from("push_subscriptions").delete().in("endpoint", old);
  }
  return NextResponse.json({ ok: !error, message: error?.message });
}
export async function DELETE(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  await auditCall("pushOff", {});
  if (b.endpoint) await serviceClient().from("push_subscriptions").delete().eq("endpoint", b.endpoint).eq("user_id", v.userId);
  return NextResponse.json({ ok: true });
}
