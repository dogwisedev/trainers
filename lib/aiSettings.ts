import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import type { Kind } from "./reports";

// The switches for the AI help and the checklists submitted forms are checked against (migration 055). Changed on
// Pulse → Office by any admin; kept in app_settings. Before the migration: the defaults below, forms checked as "suggest".
export type CheckMode = "off" | "suggest" | "auto";
export type AiSettings = { formCheck: CheckMode; handoverDrafts: boolean; captions: boolean; voice: boolean; checklists: Record<Kind, string> };

export const DEFAULT_CHECKLISTS: Record<Kind, string> = {
  weekly: `- Every question is answered, and every "yes" (skin, body, eyes, potty, appetite) says what was seen, where, and since when.
- A weight change ("Heavier" or "Lighter") has a note saying what was noticed.
- "Energy and mood" says something specific about this dog this week, not one or two words.
- Nothing contradicts the chat: if the trainer's or client's messages mention vomiting, limping, a wound, not eating or a vet visit this week, the form mentions it too.
- Anything that sounds like the dog needs a vet is flagged for the office.`,
  intake: `- The behavior assessment at pickup describes what the dog actually did, not just "good" or "fine".
- The list of items from the client is specific (leash, crate, food amount), not "a few things".
- Food: how much the dog eats a day is a real amount; if food wasn't provided or isn't the same as at home, it says so.
- Medication: if yes, the detail gives the health issue, the medication and how often.
- Snout to tail describes the dog's condition (coat, skin, eyes, ears, teeth, paws, weight), including anything already there at pickup, such as scars or hot spots.
- Miles are a sensible round-trip number for a pickup (0 only if the client brought the dog).`,
  handover: `- The goals are the owner's own goals for this dog, in words they would recognize.
- Each training item says what was worked on and how the dog does now, with specifics. Each homework item is a clear instruction the owner can follow at home.
- The overall review is honest: what went well, what still needs work, and what the owner should keep doing.
- No promises or guarantees ("fully trained", "will never"), nothing negative about the owner, nothing that blames the dog.
- Snout to tail at handover is filled in with real findings from the session with the owner.
- Reads well for a client: no typos that change meaning, no notes meant for the office, no placeholder text.
- Nothing contradicts the chat or the weekly health checks.`
};
const DEFAULTS: AiSettings = { formCheck: "suggest", handoverDrafts: true, captions: true, voice: true, checklists: DEFAULT_CHECKLISTS };

export async function aiSettings(sb: SupabaseClient = serviceClient()): Promise<AiSettings> {
  const { data, error } = await sb.from("app_settings").select("key, value").like("key", "ai.%");
  if (error) return DEFAULTS;
  const v = new Map(((data || []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const mode = v.get("ai.formCheck");
  const list = (k: Kind) => { const x = v.get(`ai.checklist.${k}`); return typeof x === "string" && x.trim() ? x : DEFAULT_CHECKLISTS[k]; };
  return {
    formCheck: mode === "off" || mode === "auto" || mode === "suggest" ? mode : DEFAULTS.formCheck,
    handoverDrafts: v.get("ai.handoverDrafts") !== false, captions: v.get("ai.captions") !== false, voice: v.get("ai.voice") !== false,
    checklists: { weekly: list("weekly"), intake: list("intake"), handover: list("handover") }
  };
}
/** Saves one setting; returns an error message, or null. */
export async function saveAiSetting(key: string, value: unknown, by: string, sb: SupabaseClient = serviceClient()): Promise<string | null> {
  const { error } = await sb.from("app_settings").upsert({ key: `ai.${key}`, value, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return error ? (/app_settings|schema cache/i.test(error.message) ? "Run migration 055 in Supabase first." : error.message) : null;
}
