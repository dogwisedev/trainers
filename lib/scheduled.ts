import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { notifyMessage } from "./chatNotify";
import type { MediaRef } from "./chatTypes";

// Scheduled messages (migration 041): written now, posted into the chat later by the 10-minute chat job, as the person who
// scheduled it. Everything the client sees (the message, previews, notifications) happens at posting time, not before.

export type Scheduled = { id: string; chat_id: string; created_by: string; sender_role: "admin" | "trainer"; sender_name: string | null; body: string | null; media: MediaRef[]; send_at: string; sent_message_id: string | null; cancelled_at: string | null };

/** Pending scheduled messages on a chat (for the trainer and the office; never the client). */
export async function listScheduled(chatId: string, sb: SupabaseClient = serviceClient()): Promise<Scheduled[]> {
  const { data, error } = await sb.from("scheduled_messages").select("*").eq("chat_id", chatId).is("sent_message_id", null).is("cancelled_at", null).order("send_at");
  if (error) return []; // before migration 041: nothing scheduled
  return (data || []) as Scheduled[];
}

/** Posts every scheduled message whose time has come. Runs with the chat job. */
export async function releaseScheduled(now = new Date(), sb: SupabaseClient = serviceClient()): Promise<{ posted: number; errors: string[] }> {
  const out = { posted: 0, errors: [] as string[] };
  const { data, error } = await sb.from("scheduled_messages").select("*").lte("send_at", now.toISOString()).is("sent_message_id", null).is("cancelled_at", null).order("send_at").limit(50);
  if (error) { if (!/scheduled_messages|schema cache/i.test(error.message)) out.errors.push(error.message); return out; }
  for (const m of (data || []) as Scheduled[]) {
    try {
      const { data: chat } = await sb.from("chats").select("status").eq("id", m.chat_id).maybeSingle();
      if (!chat || chat.status !== "open") { await sb.from("scheduled_messages").update({ cancelled_at: now.toISOString(), note: "The chat was closed before it could be sent." }).eq("id", m.id); continue; }
      const media = Array.isArray(m.media) ? m.media : [];
      // The server inserts, so the sender is set here (the trigger only fills it for signed-in writers)
      const { data: msg, error: e } = await sb.from("chat_messages").insert({ chat_id: m.chat_id, kind: media.length ? "media" : "text", body: m.body || null, media, sender_id: m.created_by, sender_role: m.sender_role, sender_name: m.sender_name }).select("id").single();
      if (e || !msg) { out.errors.push(`${m.id}: ${e?.message || "no id"}`); continue; }
      await sb.from("scheduled_messages").update({ sent_message_id: msg.id }).eq("id", m.id);
      await notifyMessage(msg.id, sb).catch(() => {});
      out.posted++;
    } catch (e) { out.errors.push(`${m.id}: ${(e as Error).message}`); }
  }
  return out;
}
