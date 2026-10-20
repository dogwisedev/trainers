import "server-only";
import webpush from "web-push";
import { serviceClient, isDemo } from "./supabase";

// Phone notifications. Vercel variables: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Never throws: a missed notification must never break the thing that triggered it (emails still go out as before).
export const pushConfigured = () => !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
let ready = false;
const setup = () => { if (!ready) { webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:info@dogwiseacademy.com", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!); ready = true; } };
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

export type Push = { title: string; body: string; url: string; tag?: string };

export async function pushToUsers(userIds: (string | null | undefined)[], p: Push) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (isDemo() || !pushConfigured() || !ids.length) return 0;
  try {
    setup();
    const sb = serviceClient();
    const { data } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth").in("user_id", ids);
    let sent = 0;
    await Promise.all(((data || []) as { endpoint: string; p256dh: string; auth: string }[]).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ ...p, url: p.url.startsWith("http") ? p.url : `${site()}${p.url}`, body: p.body.slice(0, 180) }), { TTL: 86400, urgency: "high" });
        sent++;
        await sb.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint); // phone turned them off or uninstalled
      }
    }));
    return sent;
  } catch { return 0; }
}

/** Everyone logged in as this trainer. */
export async function pushToTrainer(trainerId: string | null | undefined, p: Push) {
  if (!trainerId || isDemo()) return 0;
  const { data } = await serviceClient().from("profiles").select("id").eq("trainer_id", trainerId);
  return pushToUsers(((data || []) as { id: string }[]).map((x) => x.id), p);
}
export async function pushToAdmins(p: Push) {
  if (isDemo()) return 0;
  const { data } = await serviceClient().from("profiles").select("id").eq("role", "admin");
  return pushToUsers(((data || []) as { id: string }[]).map((x) => x.id), p);
}

/** Troubleshooting: send a test to each of this user's devices and report exactly what the push service answered. */
export async function pushTestDetailed(userId: string, onlyEndpoint?: string): Promise<{ device: string; endpoint: string; status: number | null; error: string | null; thisDevice: boolean }[]> {
  if (isDemo() || !pushConfigured()) return [];
  setup();
  const sb = serviceClient();
  const { data } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth, device").eq("user_id", userId);
  return Promise.all(((data || []) as { endpoint: string; p256dh: string; auth: string; device: string | null }[]).map(async (s) => {
    try {
      const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: "Test from the Dogwise server", body: `Sent ${new Date().toLocaleTimeString("en-US")}. If you can read this, notifications work.`, url: "/", tag: "test" }), { TTL: 600, urgency: "high" });
      await sb.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
      return { device: s.device || "", endpoint: s.endpoint, status: r.statusCode, error: null, thisDevice: s.endpoint === onlyEndpoint };
    } catch (e) {
      const x = e as { statusCode?: number; body?: string; message?: string };
      return { device: s.device || "", endpoint: s.endpoint, status: x.statusCode ?? null, error: (x.body || x.message || "failed").slice(0, 300), thisDevice: s.endpoint === onlyEndpoint };
    }
  }));
}
