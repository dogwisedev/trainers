import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { addDays, todayIso } from "./dates";

// Trainer ratings, the Tower's rule (Sean, tower.py STEP 4): over the last 7 days, a miss is a day in care with no photo or
// video from the trainer, or a client waiting over 3 waking hours for a reply (the app's first reminder fires at 3 waking
// hours, so each one is a miss). 0 or 1 misses is green, 2 amber, 3 or more red; a client complaint about communication is
// red whatever the count. Only trainers with dogs in care are rated.

export type Rating = { trainerId: string; trainer: string; rating: "green" | "amber" | "red"; misses: number; noMedia: number; slowReplies: number; complaint: boolean; dogDays: number; why: string };
const etDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export async function trainerRatings(days = 7, sb: SupabaseClient = serviceClient()): Promise<Rating[]> {
  const to = todayIso(), from = addDays(to, -days); // the last `days` full days, not today
  const fromIso = `${from}T05:00:00Z`, toIso = `${to}T05:00:00Z`;
  const { data: bks } = await sb.from("bookings").select("id, hubspot_deal_id, trainer_id, start_date, end_date, dog_name, trainers(name)").neq("status", "cancelled").lt("start_date", to).gt("end_date", from).not("trainer_id", "is", null);
  const bookings = (bks || []) as unknown as { id: string; hubspot_deal_id: string | null; trainer_id: string; start_date: string; end_date: string; dog_name: string | null; trainers: { name: string } | null }[];
  if (!bookings.length) return [];
  const { data: chats } = await sb.from("chats").select("id, deal_key, trainer_id, quiet_at").in("deal_key", [...new Set(bookings.map((b) => b.hubspot_deal_id || b.id))]);
  const chatOf = new Map(((chats || []) as { id: string; deal_key: string; quiet_at: string | null }[]).map((c) => [c.deal_key, c]));
  const chatIds = [...chatOf.values()].map((c) => c.id);
  const [{ data: media }, { data: waits }, { data: labels }] = await Promise.all([
    chatIds.length ? sb.from("chat_messages").select("chat_id, created_at").in("chat_id", chatIds).eq("sender_role", "trainer").eq("kind", "media").gte("created_at", fromIso).lt("created_at", toIso).limit(20000) : Promise.resolve({ data: [] }),
    sb.from("nudges").select("trainer_id, chat_id").eq("kind", "client_waiting").eq("step", 1).gte("sent_at", fromIso).lt("sent_at", toIso).limit(5000),
    chatIds.length ? sb.from("message_needs").select("chat_id, needs, why").in("chat_id", chatIds).in("needs", ["urgent", "office"]).gte("sent_at", fromIso).lt("sent_at", toIso).limit(5000) : Promise.resolve({ data: [] })
  ]);
  const posted = new Set(((media || []) as { chat_id: string; created_at: string }[]).map((m) => `${m.chat_id}|${etDay(m.created_at)}`));
  const out = new Map<string, Rating>();
  for (const b of bookings) {
    const chat = chatOf.get(b.hubspot_deal_id || b.id);
    if (chat?.quiet_at) continue; // finishing on Signal: nothing to rate in the app
    const r = out.get(b.trainer_id) || { trainerId: b.trainer_id, trainer: b.trainers?.name || "?", rating: "green" as const, misses: 0, noMedia: 0, slowReplies: 0, complaint: false, dogDays: 0, why: "" };
    for (let d = b.start_date > from ? b.start_date : from; d < to && d < b.end_date; d = addDays(d, 1)) {
      r.dogDays++;
      if (!chat || !posted.has(`${chat.id}|${d}`)) r.noMedia++;
    }
    out.set(b.trainer_id, r);
  }
  for (const w of (waits || []) as { trainer_id: string | null }[]) { const r = w.trainer_id ? out.get(w.trainer_id) : undefined; if (r) r.slowReplies++; }
  const trainerOfChat = new Map(((chats || []) as { id: string; trainer_id: string }[]).map((c) => [c.id, c.trainer_id]));
  for (const l of (labels || []) as { chat_id: string; why: string | null }[]) {
    if (!/(communicat|update|hear(d)? from|no (video|photo|news)|not (seen|heard)|reply|respond)/i.test(l.why || "")) continue;
    const r = out.get(trainerOfChat.get(l.chat_id) || ""); if (r) r.complaint = true;
  }
  for (const r of out.values()) {
    r.misses = r.noMedia + r.slowReplies;
    r.rating = r.complaint || r.misses >= 3 ? "red" : r.misses === 2 ? "amber" : "green";
    r.why = [r.noMedia ? `${r.noMedia} day${r.noMedia === 1 ? "" : "s"} with no photo or video (of ${r.dogDays} dog-days)` : `a photo or video every day (${r.dogDays} dog-days)`, r.slowReplies ? `${r.slowReplies} client${r.slowReplies === 1 ? "" : "s"} waiting over 3 waking hours` : "", r.complaint ? "a client complaint about communication" : ""].filter(Boolean).join(", ");
  }
  return [...out.values()].sort((a, b) => ({ red: 0, amber: 1, green: 2 }[a.rating] - { red: 0, amber: 1, green: 2 }[b.rating]) || b.misses - a.misses);
}
