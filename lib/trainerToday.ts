import "server-only";
import { isDemo, serviceClient } from "./supabase";
import { RULES, etDay, etParts, needsUpdateOn } from "./chatRules";
import { etAt } from "./commsTime";
import { trainerZone } from "./moveRules";

// The trainer's "To do today" (Today page): clients waiting on them, with their words, and the dogs that still need
// today's update. Each row links to the chat and drops off once it's done (a reply, a post). Same rules as the
// reminders (lib/nudges.ts), so the card and the 6 PM notification always agree. Quiet (Signal) chats are left out.

export type Waiting = { chatId: string; client: string; dog: string; since: string; said: string };
export type UpdateDue = { chatId: string; dog: string; client: string };
export type TrainerToday = { waiting: Waiting[]; updates: UpdateDue[]; posted: string[]; cutoff: string };

type Chat = { id: string; deal_key: string; title: string | null; client_name: string | null; quiet_at: string | null; last_trainer_at: string | null; last_client_at: string | null; last_admin_at: string | null; last_reply_at?: string | null };
type Bk = { id: string; hubspot_deal_id: string | null; dog_name: string | null; start_date: string; end_date: string; status: string; picked_up_at?: string | null };
const ms = (v: string | null | undefined) => (v ? Date.parse(v) : 0);
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** "8 PM Eastern (5 PM your time)" for a trainer outside Eastern time, "8 PM" for one in it. */
export function cutoffLabel(state: string | null | undefined, today = etParts(new Date()).date) {
  const zone = trainerZone(state);
  if (zone === "America/New_York") return "8 PM";
  return `8 PM Eastern (${new Date(etAt(today, RULES.trainerUpdateByHour)).toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric" })} your time)`;
}

export async function trainerToday(trainerId: string, state: string | null): Promise<TrainerToday> {
  const today = etParts(new Date()).date, empty = { waiting: [], updates: [], posted: [], cutoff: cutoffLabel(state, today) };
  if (isDemo()) return empty;
  const sb = serviceClient();
  const cols = "id, deal_key, title, client_name, quiet_at, last_trainer_at, last_client_at, last_admin_at";
  const withReply = await sb.from("chats").select(`${cols}, last_reply_at`).eq("trainer_id", trainerId).eq("status", "open");
  const rows = withReply.error ? (await sb.from("chats").select(cols).eq("trainer_id", trainerId).eq("status", "open")).data : withReply.data; // before migration 049
  const chats = ((rows || []) as Chat[]).filter((c) => !c.quiet_at);
  if (!chats.length) return empty;
  // A person's reply (the trainer, or someone in the office); automatic posts don't count (migration 049)
  const lastReply = (c: Chat) => (c.last_reply_at !== undefined ? c.last_reply_at : ms(c.last_trainer_at) > ms(c.last_admin_at) ? c.last_trainer_at : c.last_admin_at);

  // Dogs that need an update today
  const keys = chats.map((c) => c.deal_key), sel = "id, hubspot_deal_id, dog_name, start_date, end_date, status, picked_up_at";
  const [a, b] = await Promise.all([
    sb.from("bookings").select(sel).in("hubspot_deal_id", keys).neq("status", "cancelled").lte("start_date", today).gt("end_date", today),
    sb.from("bookings").select(sel).in("id", keys.filter((k) => /^[0-9a-f-]{36}$/i.test(k))).neq("status", "cancelled").lte("start_date", today).gt("end_date", today)
  ]);
  const bks = [...((a.data || []) as Bk[]), ...((b.data || []) as Bk[])];
  const updates: UpdateDue[] = [], posted: string[] = [];
  for (const c of chats) {
    const due = bks.filter((x) => (x.hubspot_deal_id || x.id) === c.deal_key && needsUpdateOn(x, today));
    if (!due.length) continue;
    const dog = [...new Set(due.map((x) => (x.dog_name || "").trim()).filter(Boolean))].join(" & ") || c.title || "Your dog";
    if (etDay(c.last_trainer_at) === today) posted.push(dog);
    else updates.push({ chatId: c.id, dog, client: (c.client_name || "the client").split(" ")[0] });
  }

  // Clients waiting for a reply, from their first unanswered message, with what they said last
  const waitingChats = chats.filter((c) => c.last_client_at && ms(c.last_client_at) > ms(lastReply(c)));
  const waiting: Waiting[] = [];
  if (waitingChats.length) {
    const after = new Date(Math.min(...waitingChats.map((c) => ms(lastReply(c))))).toISOString();
    const { data: um } = await sb.from("chat_messages").select("chat_id, created_at, body").in("chat_id", waitingChats.map((c) => c.id)).eq("sender_role", "client").gt("created_at", after).order("created_at").limit(300);
    const msgs = (um || []) as { chat_id: string; created_at: string; body: string | null }[];
    for (const c of waitingChats) {
      const mine = msgs.filter((m) => m.chat_id === c.id && ms(m.created_at) > ms(lastReply(c)));
      if (!mine.length) continue;
      const last = mine[mine.length - 1];
      waiting.push({ chatId: c.id, client: c.client_name || "A client", dog: c.title || "your dog", since: mine[0].created_at, said: last.body ? clip(last.body, 120) : "Sent a photo or file" });
    }
    waiting.sort((x, y) => ms(x.since) - ms(y.since));
  }
  return { waiting, updates, posted, cutoff: cutoffLabel(state, today) };
}
