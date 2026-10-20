"use server";
import { auditCall } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient, serviceClient } from "@/lib/supabase";
import { ensureChatsForBookings } from "@/lib/chat";
import { closeChat, reopenChat, sendClosingEmail } from "@/lib/chatOps";
import { ensureClientUser, sendChatInvite } from "@/lib/authEmail";
import { mailConfigured, sendMail } from "@/lib/mail";
import { pushToTrainer, pushToUsers } from "@/lib/push";
import { BRAND_LOGO_PNG_BASE64 } from "@/lib/brandLogo";
import type { Booking } from "@/lib/types";

export type ChatResult = { ok: boolean; message: string; chatId?: string };
const DEMO: ChatResult = { ok: false, message: "Demo mode: connect Supabase to use chats." };
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const logo = { filename: "dogwise.png", content: Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: "dogwise-logo" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function adminOnly() {
  const v = await getViewer();
  if (!v || v.role !== "admin") throw new Error("Admins only.");
  return v;
}

/** Starts the chat for a booking (and its other dogs on the same deal). Doesn't email the client: use Invite client. */
export async function startChatAction(bookingId: string): Promise<ChatResult> {
  await auditCall("startChatAction", { bookingId });
  if (isDemo()) return DEMO;
  try {
    await adminOnly();
    const sb = serverClient();
    const { data: b } = await sb.from("bookings").select("*").eq("id", bookingId).maybeSingle();
    if (!b) return { ok: false, message: "Booking not found." };
    let list: Booking[] = [b as Booking];
    if (b.hubspot_deal_id) list = ((await sb.from("bookings").select("*").eq("hubspot_deal_id", b.hubspot_deal_id).neq("status", "cancelled")).data || [b]) as Booking[];
    const [r] = await ensureChatsForBookings(list, { invite: false });
    revalidatePath("/", "layout");
    return { ok: true, message: r.created ? "Chat started." : "Chat already exists.", chatId: r.chatId };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** Emails the client their chat link (again, if they lost it). Optionally sets or corrects their email first. */
export async function inviteClientAction(chatId: string, email?: string): Promise<ChatResult> {
  await auditCall("inviteClientAction", { chatId, email });
  if (isDemo()) return DEMO;
  try {
    await adminOnly();
    if (!mailConfigured()) return { ok: false, message: "Email isn't set up yet." };
    const svc = serviceClient();
    const { data: chat } = await svc.from("chats").select("*").eq("id", chatId).maybeSingle();
    if (!chat) return { ok: false, message: "Chat not found." };
    const addr = (email || chat.client_email || "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) return { ok: false, message: "Add the client's email first." };
    let userId = chat.client_user_id as string | null;
    if (!userId || addr !== (chat.client_email || "").toLowerCase()) {
      userId = await ensureClientUser(addr);
      await svc.from("profiles").upsert({ id: userId, role: "client", display_name: chat.client_name }, { onConflict: "id", ignoreDuplicates: true });
      await svc.from("chats").update({ client_user_id: userId, client_email: addr }).eq("id", chatId);
    }
    await sendChatInvite({ email: addr, clientName: chat.client_name || "", title: chat.title || "your dog", trainerName: chat.trainer_name || "", chatId });
    await svc.from("chats").update({ invited_at: new Date().toISOString() }).eq("id", chatId);
    revalidatePath(`/a/chats/${chatId}`);
    return { ok: true, message: `Chat link sent to ${addr}.` };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

/**
 * Called (without waiting) after someone sends a message. Emails the TRAINER (at most once per 20 minutes) when the client or
 * an admin writes, so replies are quick. Clients are never emailed from here.
 */
export async function notifyChatAction(chatId: string): Promise<void> {
  if (isDemo()) return;
  try {
    const v = await getViewer();
    if (!v) return;
    const { data: chat } = await serverClient().from("chats").select("*").eq("id", chatId).maybeSingle(); // row level security: only people in the chat
    if (!chat || chat.status !== "open") return;
    const { data: last } = await serverClient().from("chat_messages").select("sender_role, body, kind, sender_name").eq("chat_id", chatId).order("created_at", { ascending: false }).limit(1);
    const msg = last?.[0];
    if (!msg || msg.sender_role === "system") return;
    const svc = serviceClient(), now = Date.now(), gap = 20 * 60e3;
    const fresh = (iso: string | null) => !iso || now - new Date(iso).getTime() > gap;
    const snippet = msg.body ? `“${msg.body.slice(0, 200)}${msg.body.length > 200 ? "…" : ""}”` : "sent a photo or video";
    const send = async (to: string, subject: string, heading: string, link: string) => {
      await sendMail({ to, subject, text: `${heading}\n${msg.body || "Sent a photo or video"}\n\nOpen the chat: ${link}`,
        html: `<div style="background:#f4f5f8;padding:24px 12px;font-family:Arial,sans-serif"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E7E3F3;border-radius:16px;padding:24px"><img src="cid:dogwise-logo" width="130" alt="Dogwise Academy" style="display:block;margin-bottom:14px"><p style="font-size:16px;font-weight:bold;color:#2A1971;margin:0 0 8px">${esc(heading)}</p><p style="font-size:15px;color:#333;line-height:1.5;margin:0 0 18px">${esc(snippet)}</p><a href="${link}" style="background:#2A1971;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:bold;display:inline-block">Open the chat</a></div></div>`,
        attachments: [logo] });
    };
    const about = chat.title || "your dog";
    // Phone notifications: straight away, one per chat on the lock screen (each new message replaces the last)
    const who = msg.sender_role === "client" ? chat.client_name || "The client" : msg.sender_role === "trainer" ? chat.trainer_name || "Your trainer" : "The Dogwise team";
    const body = `${who}: ${msg.body ? msg.body.slice(0, 160) : "sent a photo or video"}`;
    if (msg.sender_role !== "trainer") await pushToTrainer(chat.trainer_id, { title: `New message about ${about}`, body, url: `/t/chats/${chat.id}`, tag: `chat-${chat.id}` });
    if (msg.sender_role !== "client" && chat.client_user_id) await pushToUsers([chat.client_user_id], { title: `New message about ${about}`, body, url: `/c/${chat.id}`, tag: `chat-${chat.id}` });
    if (!mailConfigured()) return;
    // Clients are NOT emailed here. They get at most one "new updates" email a day, from the scheduled check (lib/chatOps.ts).
    if (msg.sender_role !== "trainer" && chat.trainer_id && fresh(chat.notified_trainer_at)) {
      const { data: t } = await svc.from("trainers").select("email, dogwise_email").eq("id", chat.trainer_id).maybeSingle();
      const to = t?.email || t?.dogwise_email;
      if (to) {
        await send(to, `New message about ${about}`, `${msg.sender_role === "client" ? chat.client_name || "The client" : "The Dogwise team"} sent a message about ${about}`, `${site()}/t/chats/${chat.id}`);
        await svc.from("chats").update({ notified_trainer_at: new Date().toISOString() }).eq("id", chat.id);
      }
    }
  } catch { /* a missed notification must never break chatting */ }
}


// ── Incidents, closing, reopening ──────────────────────────────────────
export async function takeIncidentAction(id: string): Promise<ChatResult> {
  await auditCall("takeIncidentAction", { id });
  if (isDemo()) return DEMO;
  try {
    const v = await adminOnly();
    const { error } = await serverClient().from("chat_incidents").update({ status: "taken", taken_by: v.name === "Dogwise team" ? v.email || "an admin" : v.name, taken_at: new Date().toISOString() }).eq("id", id).eq("status", "open");
    revalidatePath("/a/incidents");
    return error ? { ok: false, message: error.message } : { ok: true, message: "Taken." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
export async function resolveIncidentAction(id: string, note: string): Promise<ChatResult> {
  await auditCall("resolveIncidentAction", { id, note });
  if (isDemo()) return DEMO;
  try {
    const v = await adminOnly();
    const { error } = await serverClient().from("chat_incidents").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: v.email || v.name, resolved_note: note.trim() || null }).eq("id", id).neq("status", "resolved");
    revalidatePath("/", "layout");
    return error ? { ok: false, message: error.message } : { ok: true, message: "Resolved." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
export async function closeChatAction(chatId: string): Promise<ChatResult> {
  await auditCall("closeChatAction", { chatId });
  if (isDemo()) return DEMO;
  try { await adminOnly(); const r = await closeChat(chatId); revalidatePath("/", "layout"); return { ...r, chatId }; }
  catch (e) { return { ok: false, message: (e as Error).message }; }
}
/** The client (or an admin) starts a fresh chat after the old one was closed. */
export async function reopenChatAction(chatId: string): Promise<ChatResult> {
  await auditCall("reopenChatAction", { chatId });
  if (isDemo()) return DEMO;
  try {
    const v = await getViewer();
    if (!v) return { ok: false, message: "Sign in again." };
    const { data: seen } = await serverClient().from("chats").select("id").eq("id", chatId).maybeSingle(); // row level security: only people who were in it
    if (!seen) return { ok: false, message: "Chat not found." };
    const r = await reopenChat(chatId, v.role === "admin" ? "admin" : "client");
    revalidatePath("/", "layout");
    return r;
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
export async function sendSummaryAgainAction(chatId: string): Promise<ChatResult> {
  await auditCall("sendSummaryAgainAction", { chatId });
  if (isDemo()) return DEMO;
  try {
    await adminOnly();
    const { data: chat } = await serviceClient().from("chats").select("*").eq("id", chatId).maybeSingle();
    if (!chat?.client_email) return { ok: false, message: "No client email on this chat." };
    await sendClosingEmail(chat, chat.transcript_url, chat.drive_folder_url, null);
    return { ok: true, message: `Summary sent to ${chat.client_email}.` };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
export async function setClientEmailsAction(chatId: string, on: boolean): Promise<ChatResult> {
  await auditCall("setClientEmailsAction", { chatId, on });
  if (isDemo()) return DEMO;
  try {
    await adminOnly();
    const { error } = await serverClient().from("chats").update({ client_emails: on }).eq("id", chatId);
    revalidatePath(`/a/chats/${chatId}`);
    return error ? { ok: false, message: error.message } : { ok: true, message: on ? "This client will get a daily email when there are unread updates." : "This client won't get notification emails." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
