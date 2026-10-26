import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { mailConfigured, sendMail } from "./mail";
import { pushToTrainer, pushToUsers } from "./push";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";

// Chat notifications, sent by the SERVER for every message, exactly once.
// Three routes lead here, and whichever arrives first "claims" the message (chat_messages.notified_at), so nobody gets it twice:
//  1. the database itself, the moment a message is saved (migration 033: a trigger calls /api/chat/notify)
//  2. the sender's app, right after sending (as before)
//  3. the 10-minute chat check, for anything the first two missed (lib/chatOps.ts)
// So a notification no longer depends on the sender's phone staying online after they tap Send.
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const logo = { filename: "dogwise.png", content: Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: "dogwise-logo" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const TRAINER_EMAIL_GAP = 20 * 60e3; // trainers get at most one "new message" email per chat every 20 minutes (push is every time)

type Msg = { id: string; chat_id: string; sender_role: string; body: string | null; kind: string; media: { kind?: string }[] | null };

/** Notifies the people in the chat about one message, if nobody has yet. Returns true if this call sent it. Never throws. */
export async function notifyMessage(messageId: string, sb: SupabaseClient = serviceClient(), opts: { fromSender?: boolean } = {}): Promise<boolean> {
  try {
    // Claim it: only one caller gets the row back
    let { data: claimed, error } = await sb.from("chat_messages").update({ notified_at: new Date().toISOString() })
      .eq("id", messageId).is("notified_at", null).select("id, chat_id, sender_role, body, kind, media").maybeSingle();
    if (error && /notified_at|column|schema cache/i.test(error.message)) {
      // Migration 033 not run yet: nothing to claim with, so only the sender's app notifies (as it did before)
      if (!opts.fromSender) return false;
      ({ data: claimed, error } = await sb.from("chat_messages").select("id, chat_id, sender_role, body, kind, media").eq("id", messageId).maybeSingle());
    }
    if (error || !claimed) return false;
    const msg = claimed as Msg;
    if (msg.sender_role === "system") return false;
    const { data: chat } = await sb.from("chats").select("*").eq("id", msg.chat_id).maybeSingle();
    if (!chat || chat.status !== "open") return false;
    const what = (msg.media || [])[0]?.kind === "file" ? "sent a file" : "sent a photo or video";
    const snippet = msg.body ? `“${msg.body.slice(0, 200)}${msg.body.length > 200 ? "…" : ""}”` : what;
    const about = chat.title || "your dog";
    // Phone notifications: straight away, one per chat on the lock screen (each new message replaces the last)
    const who = msg.sender_role === "client" ? chat.client_name || "The client" : msg.sender_role === "trainer" ? chat.trainer_name || "Your trainer" : "The Dogwise team";
    const body = `${who}: ${msg.body ? msg.body.slice(0, 160) : what}`;
    if (msg.sender_role !== "trainer") await pushToTrainer(chat.trainer_id, { title: `New message about ${about}`, body, url: `/t/chats/${chat.id}`, tag: `chat-${chat.id}` });
    if (msg.sender_role !== "client" && chat.client_user_id) await pushToUsers([chat.client_user_id], { title: `New message about ${about}`, body, url: `/c/${chat.id}`, tag: `chat-${chat.id}` });
    if (!mailConfigured()) return true;
    // Clients are NOT emailed here. They get at most one "new updates" email a day, from the scheduled check (lib/chatOps.ts).
    const fresh = !chat.notified_trainer_at || Date.now() - new Date(chat.notified_trainer_at).getTime() > TRAINER_EMAIL_GAP;
    if (msg.sender_role !== "trainer" && chat.trainer_id && fresh) {
      const { data: t } = await sb.from("trainers").select("email, dogwise_email").eq("id", chat.trainer_id).maybeSingle();
      const to = t?.email || t?.dogwise_email;
      if (to) {
        const heading = `${msg.sender_role === "client" ? chat.client_name || "The client" : "The Dogwise team"} sent a message about ${about}`, link = `${site()}/t/chats/${chat.id}`;
        await sendMail({ to, subject: `New message about ${about}`, text: `${heading}\n${msg.body || what}\n\nOpen the chat: ${link}`,
          html: `<div style="background:#f4f5f8;padding:24px 12px;font-family:Arial,sans-serif"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E7E3F3;border-radius:16px;padding:24px"><img src="cid:dogwise-logo" width="130" alt="Dogwise Academy" style="display:block;margin-bottom:14px"><p style="font-size:16px;font-weight:bold;color:#281870;margin:0 0 8px">${esc(heading)}</p><p style="font-size:15px;color:#333;line-height:1.5;margin:0 0 18px">${esc(snippet)}</p><a href="${link}" style="background:#281870;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:bold;display:inline-block">Open the chat</a></div></div>`,
          attachments: [logo] });
        await sb.from("chats").update({ notified_trainer_at: new Date().toISOString() }).eq("id", chat.id);
      }
    }
    return true;
  } catch { return false; /* a missed notification must never break chatting; the 10-minute check retries what wasn't claimed */ }
}

/** Safety net (10-minute chat check): messages from the last 6 hours that nobody has notified about yet. */
export async function sweepNotifications(sb: SupabaseClient = serviceClient()): Promise<number> {
  const now = Date.now();
  const { data, error } = await sb.from("chat_messages").select("id").is("notified_at", null).neq("sender_role", "system")
    .lt("created_at", new Date(now - 90e3).toISOString()).gt("created_at", new Date(now - 6 * 3600e3).toISOString()).order("created_at").limit(60);
  if (error) return 0; // migration 033 not run yet
  let sent = 0;
  for (const m of (data || []) as { id: string }[]) if (await notifyMessage(m.id, sb)) sent++;
  return sent;
}

/** The database calls /api/chat/notify with this key (kept in app_state, which only the server can read). */
let keyCache: { v: string | null; at: number } | null = null;
export async function notifyKey(sb: SupabaseClient = serviceClient()): Promise<string | null> {
  if (keyCache && Date.now() - keyCache.at < 10 * 60e3) return keyCache.v;
  const { data } = await sb.from("app_state").select("value").eq("key", "notify_secret").maybeSingle();
  keyCache = { v: (data?.value as string | null) || null, at: Date.now() };
  return keyCache.v;
}
/** Tells the database where to call (run by the chat check, so nothing needs setting up by hand). */
export async function registerNotifyUrl(sb: SupabaseClient = serviceClient()) {
  const url = site() ? `${site()}/api/chat/notify` : "";
  if (!url) return;
  const { data } = await sb.from("app_state").select("value").eq("key", "notify_url").maybeSingle();
  if (data?.value !== url) await sb.from("app_state").upsert({ key: "notify_url", value: url, updated_at: new Date().toISOString() });
}
