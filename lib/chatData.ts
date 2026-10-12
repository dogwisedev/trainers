import "server-only";
import { isDemo, serverClient } from "./supabase";
import seed from "./demo-seed.json";
import { ChatMsg, ChatRow, chatUnread } from "./chatTypes";
import { Trainer, Viewer } from "./types";

const demoTrainers = (seed as unknown as { trainers: Trainer[] }).trainers;
const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const alex = demoTrainers.find((t) => t.name.startsWith("Alex")) || demoTrainers[0];
const feli = demoTrainers.find((t) => t.name.startsWith("Felicity")) || demoTrainers[1];
const blank = { drive_folder_id: null, drive_folder_url: null, invited_at: ago(30), created_at: ago(72), closed_at: null, status: "open" as const, last_admin_at: null, admin_seen_at: null };
const DEMO_CHATS: ChatRow[] = [
  { ...blank, id: "demo-chat-1", deal_key: "d1", trainer_id: alex.id, trainer_name: alex.name, client_user_id: "demo-client", client_name: "Rolanda", client_email: "rolanda@example.com", title: "Joss", last_message_at: ago(1), last_preview: "Thank you! She looks so happy", last_sender: "client", last_trainer_at: ago(3), last_client_at: ago(1) },
  { ...blank, id: "demo-chat-2", deal_key: "d2", trainer_id: feli.id, trainer_name: feli.name, client_user_id: null, client_name: "Jessica Miller", client_email: null, title: "Kya & Milo", invited_at: null, last_message_at: ago(20), last_preview: "Both dogs settled in great", last_sender: "trainer", last_trainer_at: ago(20), last_client_at: null }
];
const m = (id: string, chat: string, role: ChatMsg["sender_role"], name: string, body: string | null, h: number, extra: Partial<ChatMsg> = {}): ChatMsg =>
  ({ id, chat_id: chat, sender_id: null, sender_role: role, sender_name: name, kind: "text", body, media: [], report_id: null, created_at: ago(h), ...extra });
const DEMO_MSGS: ChatMsg[] = [
  m("a1", "demo-chat-1", "system", "Dogwise", "Chat opened. Say hello!", 70, { kind: "system" }),
  m("a2", "demo-chat-1", "trainer", alex.name, "Hi Rolanda! Joss arrived safely and ate all her dinner. She's a sweetheart.", 48),
  m("a3", "demo-chat-1", "trainer", alex.name, "First walk of the week", 26, { kind: "media", media: [{ id: "DEMO1", name: "first-walk.mp4", kind: "video" }] }),
  m("a4", "demo-chat-1", "client", "Rolanda", "Amazing, thank you for the update!", 25),
  m("a5", "demo-chat-1", "admin", "Dogwise team", "Welcome Rolanda! Week 1 report coming Wednesday.", 24),
  m("a6", "demo-chat-1", "trainer", alex.name, "Today's session: loose leash practice.", 3, { kind: "media", media: [{ id: "DEMO2", name: "heel.jpg", kind: "photo" }] }),
  m("a7", "demo-chat-1", "client", "Rolanda", "Thank you! She looks so happy", 1),
  m("b1", "demo-chat-2", "trainer", feli.name, "Both dogs settled in great", 20)
];

export async function listChats(): Promise<ChatRow[]> {
  if (isDemo()) return DEMO_CHATS;
  const { data } = await serverClient().from("chats").select("*").order("last_message_at", { ascending: false, nullsFirst: false }).limit(500);
  return (data || []) as ChatRow[];
}
export async function getChat(id: string): Promise<ChatRow | null> {
  if (isDemo()) return DEMO_CHATS.find((c) => c.id === id) || null;
  const { data } = await serverClient().from("chats").select("*").eq("id", id).maybeSingle();
  return (data as ChatRow) || null;
}
/** The latest `limit` messages, oldest first, and whether there are older ones. */
export async function listChatMessages(chatId: string, limit = 100): Promise<{ messages: ChatMsg[]; hasMore: boolean }> {
  if (isDemo()) return { messages: DEMO_MSGS.filter((x) => x.chat_id === chatId), hasMore: false };
  const { data } = await serverClient().from("chat_messages").select("*").eq("chat_id", chatId).order("created_at", { ascending: false }).limit(limit + 1);
  const rows = (data || []) as ChatMsg[];
  return { messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit };
}
export async function chatReads(userId: string): Promise<Record<string, string>> {
  if (isDemo()) return {};
  const { data } = await serverClient().from("chat_reads").select("chat_id, last_read_at").eq("user_id", userId);
  return Object.fromEntries((data || []).map((r: { chat_id: string; last_read_at: string }) => [r.chat_id, r.last_read_at]));
}
/** Number of chats with something new, for the nav badge. */
export async function unreadChats(v: Viewer): Promise<number> {
  if (v.role === "client" && !v.demo) { /* falls through: clients see only their own chats through row level security */ }
  const [chats, reads] = await Promise.all([listChats(), v.role === "admin" ? Promise.resolve({} as Record<string, string>) : chatReads(v.userId)]);
  return chats.filter((c) => c.status === "open" && chatUnread(c, v.role, reads[c.id])).length;
}
