"use server";
import { revalidatePath } from "next/cache";
import { audited } from "@/lib/audit";
import { getViewer } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { VOICE, aiOn, claude } from "@/lib/ai";
import { aiSettings, saveAiSetting, type CheckMode } from "@/lib/aiSettings";
import type { Kind } from "@/lib/reports";

// The AI help's switches and checklists (Pulse → Office, any admin), and the update-caption helper in a dog's chat (trainers).
type R = { ok: boolean; message: string };
const admin = async () => { const v = await getViewer(); if (!v || v.role !== "admin") throw new Error("Admins only."); return v.name === "Dogwise team" || v.name === "Dogwise Admin" ? (v.email || v.name).split("@")[0] : v.name; };

export async function setAiSettingAction(key: "formCheck" | "handoverDrafts" | "captions" | "voice" | "vaccineChecks", value: CheckMode | boolean): Promise<R> {
  return audited("setAiSettingAction", { key, value }, async () => {
    try {
      if (isDemo()) return { ok: false, message: "Demo mode." };
      const by = await admin();
      if (key === "formCheck" ? !["off", "suggest", "auto"].includes(String(value)) : typeof value !== "boolean") return { ok: false, message: "Not a setting." };
      const err = await saveAiSetting(key, value, by);
      revalidatePath("/a/pulse");
      return err ? { ok: false, message: err } : { ok: true, message: "Saved." };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  });
}

export async function saveChecklistAction(kind: Kind | "vaccines", text: string): Promise<R> {
  return audited("saveChecklistAction", { kind, text }, async () => {
    try {
      if (isDemo()) return { ok: false, message: "Demo mode." };
      const by = await admin();
      if (!["weekly", "intake", "handover", "vaccines"].includes(kind)) return { ok: false, message: "Not a form." };
      const t = text.trim().slice(0, 4000);
      const err = await saveAiSetting(`checklist.${kind}`, t, by); // empty = back to the built-in checklist
      revalidatePath("/a/ai");
      return err ? { ok: false, message: err } : { ok: true, message: t ? "Saved. Forms sent in from now on are checked against it." : "Back to the built-in checklist." };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  });
}

// ── Update captions (trainers, in a dog's chat) ──
/** A few words from the trainer → a short update for the owner, in the trainer's own voice. They can change it before sending. */
export async function captionAction(chatId: string, words: string): Promise<R & { id?: string; text?: string }> {
  try {
    if (isDemo()) return { ok: false, message: "Demo mode." };
    const v = await getViewer();
    if (!v || v.role !== "trainer" || !v.trainerId) return { ok: false, message: "Trainers only." };
    const w = words.replace(/\s+/g, " ").trim().slice(0, 600);
    if (w.split(" ").length < 2) return { ok: false, message: "Type a few words first: what did you work on, how did it go?" };
    if (!aiOn()) return { ok: false, message: "This isn't switched on yet." };
    const sb = serviceClient();
    if (!(await aiSettings(sb)).captions) return { ok: false, message: "This is switched off." };
    const { data: chat } = await sb.from("chats").select("id, title, client_name, trainer_id").eq("id", chatId).maybeSingle();
    if (!chat || chat.trainer_id !== v.trainerId) return { ok: false, message: "Chat not found." };
    // Their own recent updates, for the voice (this chat first, then their other chats)
    const { data: mine } = await sb.from("chat_messages").select("body").eq("sender_id", v.userId).eq("sender_role", "trainer").not("body", "is", null).order("created_at", { ascending: false }).limit(40);
    const samples = ((mine || []) as { body: string | null }[]).map((m) => (m.body || "").replace(/\s+/g, " ").trim()).filter((b) => b.split(" ").length >= 6).slice(0, 8);
    const text = await claude({ maxTokens: 220, timeoutMs: 12000,
      system: `You turn a dog trainer's quick notes into a short update for the dog's owner, posted in the dog's chat with a photo or video. One to three sentences, in the trainer's own voice.\n\n${VOICE}\n- Say only what the notes say. Do not add anything about the dog that isn't in the notes.\n- Write as the trainer ("we", "I"). Use the dog's name. No greeting, no sign-off, no hashtags.\nAnswer with the update only.`,
      user: `Dog: ${chat.title || "the dog"}. Owner: ${(chat.client_name || "").split(" ")[0] || "the owner"}.\n\nThe trainer's notes for today's update:\n${w}\n\n${samples.length ? `How this trainer writes (their recent messages):\n${samples.map((x) => `- ${x.slice(0, 300)}`).join("\n")}` : "No earlier messages from this trainer."}` });
    const out = (text || "").replace(/^["“]|["”]$/g, "").trim();
    if (!out) return { ok: false, message: "Couldn't suggest one just now. Send your own words, or try again." };
    const { data: row } = await sb.from("ai_captions").insert({ trainer_id: v.trainerId, chat_id: chatId, words: w, suggested: out }).select("id").maybeSingle();
    return { ok: true, message: "", id: row?.id, text: out };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
/** The trainer sent a message that started as a suggested caption: what they sent, to see how often it's used as it is. */
export async function captionUsedAction(id: string, final: string): Promise<void> {
  try {
    const v = await getViewer();
    if (!v?.trainerId || isDemo()) return;
    await serviceClient().from("ai_captions").update({ final: final.slice(0, 2000), used_at: new Date().toISOString() }).eq("id", id).eq("trainer_id", v.trainerId);
  } catch { /* never in the way of sending */ }
}
