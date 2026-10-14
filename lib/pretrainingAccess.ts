import "server-only";
import { getViewer } from "./data";
import { isDemo, serviceClient } from "./supabase";
import type { Viewer } from "./types";

export type ProfileChat = { id: string; deal_key: string; title: string | null; client_name: string | null; trainer_id: string | null; trainer_name: string | null; client_user_id: string | null; status: string; drive_folder_id: string | null; drive_folder_url: string | null };

/** The chat behind a Dog profile, if this person may see it: admins any, the chat's trainer, the chat's client. `edit` = admin or client. */
export async function profileAccess(chatId: string): Promise<{ v: Viewer; chat: ProfileChat; dealId: string | null; edit: boolean } | null> {
  const v = await getViewer();
  if (!v || isDemo()) return null;
  const { data } = await serviceClient().from("chats").select("id, deal_key, title, client_name, trainer_id, trainer_name, client_user_id, status, drive_folder_id, drive_folder_url").eq("id", chatId).maybeSingle();
  const chat = data as ProfileChat | null;
  if (!chat) return null;
  const allowed = v.role === "admin" || (v.role === "trainer" && chat.trainer_id === v.trainerId) || (v.role === "client" && chat.client_user_id === v.userId);
  if (!allowed) return null;
  return { v, chat, dealId: /^\d+$/.test(chat.deal_key) ? chat.deal_key : null, edit: v.role === "admin" || v.role === "client" };
}
