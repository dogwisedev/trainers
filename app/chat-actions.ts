"use server";
import { audited } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient, serviceClient } from "@/lib/supabase";
import { ensureChatsForBookings, postWelcome } from "@/lib/chat";
import { closeChat, reopenChat, sendClosingEmail, trainingOver } from "@/lib/chatOps";
import { short } from "@/lib/dates";
import { ensureClientUser, sendChatInvite } from "@/lib/authEmail";
import { mailConfigured, sendMail } from "@/lib/mail";
import { notifyMessage } from "@/lib/chatNotify";
import { BRAND_LOGO_PNG_BASE64 } from "@/lib/brandLogo";
import type { Booking } from "@/lib/types";
import { QUIET_KINDS, QUIET_LABEL, canQuiet } from "@/lib/quietChats";
import { trashDriveFile } from "@/lib/drive";

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
  return audited("startChatAction", { bookingId }, async () => {
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
});
}

/** Emails the client their chat link (again, if they lost it). Optionally sets or corrects their email first. */
export async function inviteClientAction(chatId: string, email?: string): Promise<ChatResult> {
  return audited("inviteClientAction", { chatId, email }, async () => {
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
    await postWelcome(chatId, chat.title || "your dog", chat.trainer_name || null);
    await svc.from("chats").update({ invited_at: new Date().toISOString() }).eq("id", chatId);
    revalidatePath(`/a/chats/${chatId}`);
    return { ok: true, message: `Chat link sent to ${addr}.` };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}

/**
 * Called (without waiting) after someone sends a message. Emails the TRAINER (at most once per 20 minutes) when the client or
 * an admin writes, so replies are quick. Clients are never emailed from here.
 */
/** The sender's app asks for its message to be notified (the database and the 10-minute check do too; only the first one sends). */
export async function notifyChatAction(chatId: string, messageId?: string): Promise<void> {
  if (isDemo()) return;
  try {
    const v = await getViewer();
    if (!v) return;
    // Row level security: only people in the chat can see its messages, so this also checks the caller belongs here
    let q = serverClient().from("chat_messages").select("id").eq("chat_id", chatId);
    q = messageId ? q.eq("id", messageId) : q.order("created_at", { ascending: false }).limit(1);
    const { data } = await q;
    const id = (data as { id: string }[] | null)?.[0]?.id;
    if (id) await notifyMessage(id, undefined, { fromSender: true });
  } catch { /* a missed notification must never break chatting */ }
}

// ── Incidents, closing, reopening ──────────────────────────────────────
export async function takeIncidentAction(id: string): Promise<ChatResult> {
  return audited("takeIncidentAction", { id }, async () => {
  if (isDemo()) return DEMO;
  try {
    const v = await adminOnly();
    const { error } = await serverClient().from("chat_incidents").update({ status: "taken", taken_by: v.name === "Dogwise team" ? v.email || "an admin" : v.name, taken_at: new Date().toISOString() }).eq("id", id).eq("status", "open");
    revalidatePath("/a/incidents");
    return error ? { ok: false, message: error.message } : { ok: true, message: "Taken." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}
export async function resolveIncidentAction(id: string, note: string): Promise<ChatResult> {
  return audited("resolveIncidentAction", { id, note }, async () => {
  if (isDemo()) return DEMO;
  try {
    const v = await adminOnly();
    const { error } = await serverClient().from("chat_incidents").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: v.email || v.name, resolved_note: note.trim() || null }).eq("id", id).neq("status", "resolved");
    revalidatePath("/", "layout");
    return error ? { ok: false, message: error.message } : { ok: true, message: "Resolved." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}
export async function closeChatAction(chatId: string): Promise<ChatResult> {
  return audited("closeChatAction", { chatId }, async () => {
  if (isDemo()) return DEMO;
  try {
    await adminOnly();
    // Only after training: while a dog is in care or coming up, the chat stays open (it closes by itself ~2 months after, with a notice)
    const t = await trainingOver(chatId);
    if (!t.over) return { ok: false, message: `This chat can't be closed yet: training runs until ${t.lastDropOff ? short(t.lastDropOff) : "the last drop-off"}. You can close it from the day after.`, chatId };
    const r = await closeChat(chatId); revalidatePath("/", "layout"); return { ...r, chatId };
  }
  catch (e) { return { ok: false, message: (e as Error).message }; }
});
}
/** The client (or an admin) starts a fresh chat after the old one was closed. */
export async function reopenChatAction(chatId: string): Promise<ChatResult> {
  return audited("reopenChatAction", { chatId }, async () => {
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
});
}
export async function sendSummaryAgainAction(chatId: string): Promise<ChatResult> {
  return audited("sendSummaryAgainAction", { chatId }, async () => {
  if (isDemo()) return DEMO;
  try {
    await adminOnly();
    const { data: chat } = await serviceClient().from("chats").select("*").eq("id", chatId).maybeSingle();
    if (!chat?.client_email) return { ok: false, message: "No client email on this chat." };
    await sendClosingEmail(chat, chat.transcript_url, chat.drive_folder_url, null);
    return { ok: true, message: `Summary sent to ${chat.client_email}.` };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}
export async function setClientEmailsAction(chatId: string, on: boolean): Promise<ChatResult> {
  return audited("setClientEmailsAction", { chatId, on }, async () => {
  if (isDemo()) return DEMO;
  try {
    await adminOnly();
    const { error } = await serverClient().from("chats").update({ client_emails: on }).eq("id", chatId);
    revalidatePath(`/a/chats/${chatId}`);
    return error ? { ok: false, message: error.message } : { ok: true, message: on ? "This client will get a daily email when there are unread updates." : "This client won't get notification emails." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}

/** Admin: send the welcome email again (new button + password) to every client in these chats who hasn't opened their chat yet. */
export async function resendInvitesAction(chatIds: string[]): Promise<ChatResult> {
  return audited("resendInvitesAction", { count: chatIds.length }, async () => {
  if (isDemo()) return { ok: false, message: "Demo mode." };
  const v = await getViewer();
  if (v?.role !== "admin") return { ok: false, message: "Admins only." };
  const sb = serviceClient();
  const { data: chats } = await sb.from("chats").select("id, title, client_email, client_name, client_user_id, trainer_name, status").in("id", chatIds.slice(0, 200)).eq("status", "open");
  let sent = 0; const bad: string[] = [];
  for (const c of (chats || []) as { id: string; title: string | null; client_email: string | null; client_name: string | null; client_user_id: string | null; trainer_name: string | null }[]) {
    if (!c.client_email) { bad.push(`${c.title || "chat"}: no client email`); continue; }
    try {
      if (!c.client_user_id) { const uid = await ensureClientUser(c.client_email); await sb.from("chats").update({ client_user_id: uid }).eq("id", c.id); }
      await sendChatInvite({ email: c.client_email, clientName: c.client_name || "", title: c.title || "your dog", trainerName: c.trainer_name || "", chatId: c.id });
      await sb.from("chats").update({ invited_at: new Date().toISOString() }).eq("id", c.id);
      await postWelcome(c.id, c.title || "your dog", c.trainer_name);
      sent++;
    } catch (e) { bad.push(`${c.title || "chat"}: ${(e as Error).message}`); }
  }
  revalidatePath("/a/chats");
  return { ok: sent > 0 || !bad.length, message: `Sent ${sent} invite${sent === 1 ? "" : "s"}.${bad.length ? ` Not sent: ${bad.join("; ")}` : ""}` };
});
}

/** Quiet chat (finishing on Signal): no "hasn't posted", "client waiting" or "unanswered" alerts, no client update emails,
 *  no automatic invite. Only QUIET_CHAT_EMAILS (default alma@dogwiseacademy.com) may change it; checked here, not just hidden. */
export async function quietChatAction(chatId: string, on: boolean): Promise<ChatResult> {
  return audited("quietChatAction", { chatId, on }, async () => {
  if (isDemo()) return DEMO;
  try {
    const v = await adminOnly();
    if (!canQuiet(v.email)) return { ok: false, message: "Only Alma can quiet chats." };
    const sb = serviceClient(), now = new Date().toISOString();
    const { error } = await sb.from("chats").update({ quiet_at: on ? now : null, quiet_by: on ? v.name : null }).eq("id", chatId);
    if (error) return { ok: false, message: /quiet_at|column|schema cache/i.test(error.message) ? "Run migration 039 (quiet chats) in Supabase first." : error.message };
    if (on) await sb.from("chat_incidents").update({ status: "resolved", resolved_at: now, resolved_by: v.name, resolved_note: QUIET_LABEL })
      .eq("chat_id", chatId).in("kind", QUIET_KINDS).neq("status", "resolved");
    revalidatePath("/a"); revalidatePath(`/a/chats/${chatId}`);
    return { ok: true, message: on ? "Quiet. No more alerts for this chat." : "Alerts are back on for this chat.", chatId };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}

/** Schedule a message: posted into the chat at `sendAt` (within 10 minutes of it) as you. Trainer of the chat, or admin. */
export async function scheduleMessageAction(chatId: string, body: string, media: { id: string; name: string; kind: "video" | "photo" | "file"; size?: number }[], sendAt: string): Promise<ChatResult> {
  return audited("scheduleMessageAction", { chatId, sendAt, media: media.length, bodyLength: body.length }, async () => {
  if (isDemo()) return DEMO;
  try {
    const v = await getViewer();
    if (!v || (v.role !== "admin" && v.role !== "trainer")) return { ok: false, message: "Trainers and the office only." };
    const sb = serviceClient();
    const { data: chat } = await sb.from("chats").select("id, status, trainer_id").eq("id", chatId).maybeSingle();
    if (!chat || chat.status !== "open") return { ok: false, message: "This chat isn't open." };
    if (v.role === "trainer" && chat.trainer_id !== v.trainerId) return { ok: false, message: "Not your chat." };
    const text = body.trim(), when = new Date(sendAt);
    if (!text && !media.length) return { ok: false, message: "Write something or add a photo." };
    if (isNaN(when.getTime())) return { ok: false, message: "Pick a date and time." };
    if (when.getTime() < Date.now() + 5 * 60000) return { ok: false, message: "Pick a time at least 5 minutes from now (or just send it)." };
    if (when.getTime() > Date.now() + 30 * 86400000) return { ok: false, message: "Up to 30 days ahead." };
    const { error } = await sb.from("scheduled_messages").insert({ chat_id: chatId, created_by: v.userId, sender_role: v.role, sender_name: v.name, body: text || null, media, send_at: when.toISOString() });
    if (error) return { ok: false, message: /scheduled_messages|schema cache/i.test(error.message) ? "Scheduling isn't switched on yet (migration 041)." : error.message };
    revalidatePath(`/a/chats/${chatId}`); revalidatePath(`/t/chats/${chatId}`);
    return { ok: true, message: `Scheduled for ${when.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET.`, chatId };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}

/** Cancel a scheduled message that hasn't gone yet: whoever scheduled it, or admin. */
export async function cancelScheduledAction(id: string): Promise<ChatResult> {
  return audited("cancelScheduledAction", { id }, async () => {
  if (isDemo()) return DEMO;
  try {
    const v = await getViewer();
    if (!v) return { ok: false, message: "Please sign in." };
    const sb = serviceClient();
    const { data: m } = await sb.from("scheduled_messages").select("id, chat_id, created_by, sent_message_id").eq("id", id).maybeSingle();
    if (!m) return { ok: false, message: "Not found." };
    if (m.sent_message_id) return { ok: false, message: "It's already been sent." };
    if (v.role !== "admin" && m.created_by !== v.userId) return { ok: false, message: "Not yours to cancel." };
    const { error } = await sb.from("scheduled_messages").update({ cancelled_at: new Date().toISOString(), note: `Cancelled by ${v.name}` }).eq("id", id);
    if (error) return { ok: false, message: error.message };
    revalidatePath(`/a/chats/${m.chat_id}`); revalidatePath(`/t/chats/${m.chat_id}`);
    return { ok: true, message: "Cancelled.", chatId: m.chat_id };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}

/** Delete a message for everyone: trainers their own, the office any. Its photos, videos and files go to the Drive trash too. */
export async function deleteMessageAction(messageId: string): Promise<ChatResult> {
  return audited("deleteMessageAction", { messageId }, async () => {
  if (isDemo()) return DEMO;
  try {
    const v = await getViewer();
    if (!v || (v.role !== "admin" && v.role !== "trainer")) return { ok: false, message: "Trainers and the office only." };
    const sb = serviceClient();
    const { data: m } = await sb.from("chat_messages").select("id, chat_id, sender_id, sender_role, media, chats(trainer_id)").eq("id", messageId).maybeSingle();
    const msg = m as unknown as { id: string; chat_id: string; sender_id: string | null; sender_role: string; media: { id: string; name: string }[] | null; chats: { trainer_id: string | null } | null } | null;
    if (!msg) return { ok: false, message: "That message is already gone." };
    if (v.role === "trainer" && (msg.sender_id !== v.userId || msg.chats?.trainer_id !== v.trainerId)) return { ok: false, message: "You can only delete your own messages." };
    const { error } = await sb.from("chat_messages").delete().eq("id", msg.id);
    if (error) return { ok: false, message: error.message };
    const files = (msg.media || []).filter((x) => x?.id);
    const trashed = (await Promise.all(files.map((x) => trashDriveFile(x.id).catch(() => false)))).filter(Boolean).length;
    revalidatePath(`/a/chats/${msg.chat_id}`); revalidatePath(`/t/chats/${msg.chat_id}`); revalidatePath(`/c/${msg.chat_id}`);
    return { ok: true, message: files.length ? (trashed === files.length ? "Deleted, and removed from Drive." : `Deleted. ${files.length - trashed} file couldn't be removed from Drive: ask Alma.`) : "Deleted.", chatId: msg.chat_id };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}
