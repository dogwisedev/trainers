import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { postSystemMessage } from "./chat";
import { pushToTrainer } from "./push";
import { dealKey } from "./chatTypes";

// A different trainer for a dog's follow-up sessions (migration 046). They're added to the dog's chat (the program
// trainer stays in it), can see the dog, book and log the follow-ups, and are paid for them.
export async function setFollowupTrainer(bookingId: string, trainerId: string | null, by: string, sb: SupabaseClient = serviceClient()) {
  const { data: b } = await sb.from("bookings").select("id, trainer_id, hubspot_deal_id, dog_name, followup_trainer_id").eq("id", bookingId).maybeSingle();
  if (!b) return { ok: false, message: "Booking not found." };
  const to = trainerId && trainerId !== b.trainer_id ? trainerId : null; // the program trainer = no separate follow-up trainer
  const { data: t } = to ? await sb.from("trainers").select("id, name, active").eq("id", to).maybeSingle() : { data: null };
  if (to && (!t || !t.active)) return { ok: false, message: "That trainer isn't active in the app." };
  const { error } = await sb.from("bookings").update({ followup_trainer_id: to }).eq("id", bookingId);
  if (error) return { ok: false, message: /followup_trainer_id|schema cache/i.test(error.message) ? "This isn't switched on yet (migration 046)." : error.message };
  // The chat: add the new one, take the previous follow-up trainer out (never the program trainer)
  const { data: chat } = await sb.from("chats").select("id, status, extra_trainer_ids").eq("deal_key", dealKey(b as { id: string; hubspot_deal_id: string | null })).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (chat) {
    let extra = ((chat.extra_trainer_ids || []) as string[]).filter((x) => x !== b.followup_trainer_id);
    if (to && !extra.includes(to)) extra = [...extra, to];
    await sb.from("chats").update({ extra_trainer_ids: extra }).eq("id", chat.id);
    if (to && t && chat.status === "open") {
      await postSystemMessage(chat.id, { kind: "system", body: `👋 ${t.name} will do ${b.dog_name || "your dog"}'s follow-up sessions and has joined this chat.` }).catch(() => {});
      await pushToTrainer(to, { title: `You're doing ${b.dog_name || "a dog"}'s follow-ups`, body: "You've been added to the chat. Book the sessions from Follow-ups.", url: `/t/chats/${chat.id}`, tag: `fu-${bookingId}` }).catch(() => null);
    }
  }
  return { ok: true, message: to ? `${t!.name} does the follow-ups now and has joined the chat.` : "Follow-ups are back with the program trainer." };
}
