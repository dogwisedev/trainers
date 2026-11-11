import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { VOICE, aiOn, claude, jsonFrom, writerModel } from "./ai";
import { aiSettings } from "./aiSettings";
import { auditSystem } from "./audit";
import { etParts } from "./chatRules";
import { dealKey } from "./chatTypes";
import { addDays } from "./dates";
import { loadProfile } from "./pretraining";
import { pushToTrainer } from "./push";
import { ensureReport } from "./reportData";
import { Answers, Item, healthFlags, items, s } from "./reports";
import type { Booking } from "./types";

// Handover drafts (migration 055). The evening before a dog goes home (and until the report is due), the app starts the
// handover report for the trainer from what it already holds: the owner's answers before training, the intake notes, the
// weekly health checks and the dog's chat. It fills the owner's goals, the training items, the homework items, the overall
// review and "anything else", only where the trainer hasn't written yet. It never writes the health check at handover,
// the miles, or picks media. The trainer checks, changes and submits as usual; what they kept, edited or rewrote is
// recorded (reports.ai_draft.result), so Pulse → Office shows whether the drafts help.

type Fields = { goals?: string; training?: Item[]; homework?: Item[]; overall?: string; extra?: string };
export type HandoverDraft = { fields: Fields; missing: string[]; at: string; model: string; result?: Record<string, "kept" | "edited" | "rewritten"> };
export const DRAFT_KEYS = ["goals", "training", "homework", "overall", "extra"] as const;

const clip = (v: unknown, n: number) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Everything the app knows about this dog's program, as text, and how many updates the trainer wrote. */
async function material(sb: SupabaseClient, b: Booking): Promise<{ text: string; trainerNotes: number }> {
  const parts: string[] = [];
  // The owner's answers before training (the copy the app keeps)
  try {
    const p = b.hubspot_deal_id ? await loadProfile(b.hubspot_deal_id, 24 * 60) : null;
    const d = p?.dogs.find((x) => x.booking.id === b.id) || (p?.dogs.length === 1 ? p.dogs[0] : null);
    const lines = Object.entries((d?.answers || {}) as Record<string, unknown>).filter(([, v]) => String(v ?? "").trim() && String(v).length < 1500)
      .map(([k, v]) => `${k.replace(/_+/g, " ").trim()}: ${clip(v, 500)}`);
    if (lines.length) parts.push(`THE OWNER'S ANSWERS BEFORE TRAINING\n${lines.join("\n").slice(0, 4000)}`);
  } catch { /* no owner answers: the chat still carries it */ }
  // Intake notes and weekly health checks
  const { data: reps } = await sb.from("reports").select("kind, week_number, status, answers").eq("booking_id", b.id).in("kind", ["intake", "weekly"]).in("status", ["submitted", "approved"]).order("week_number");
  let notes = 0;
  for (const r of (reps || []) as { kind: "intake" | "weekly"; week_number: number; answers: Answers }[]) {
    const a = r.answers || {};
    if (r.kind === "intake") { const t = [s(a.behavior) && `Behavior at pickup: ${clip(a.behavior, 500)}`, s(a.concerns) && `Concerns the owner raised at pickup: ${clip(a.concerns, 500)}`].filter(Boolean); if (t.length) { parts.push(`INTAKE NOTES\n${t.join("\n")}`); notes++; } }
    else { const fl = healthFlags("weekly", a); parts.push(`WEEK ${r.week_number} HEALTH CHECK\nEnergy and mood: ${clip(a.mood, 500)}${s(a.notes) ? `\nNotes: ${clip(a.notes, 400)}` : ""}${fl.length ? `\nFlagged: ${fl.join(", ")}` : ""}`); notes++; }
  }
  // The chat: the trainer's updates and the owner's messages (people only, not the app's automatic posts)
  const { data: chat } = await sb.from("chats").select("id").eq("deal_key", dealKey(b)).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (chat) {
    const { data } = await sb.from("chat_messages").select("created_at, sender_role, sender_id, body, kind").eq("chat_id", chat.id).in("sender_role", ["trainer", "client", "admin"]).gte("created_at", `${addDays(b.start_date, -7)}T00:00:00Z`).order("created_at", { ascending: false }).limit(250);
    const rows = ((data || []) as { created_at: string; sender_role: string; sender_id: string | null; body: string | null; kind: string }[]).filter((m) => (m.sender_role !== "admin" || m.sender_id) && s(m.body)).reverse();
    notes += rows.filter((m) => m.sender_role === "trainer" && s(m.body).split(" ").length >= 4).length;
    let text = rows.map((m) => `${m.created_at.slice(5, 10)} ${m.sender_role === "trainer" ? "Trainer" : m.sender_role === "client" ? "Owner" : "Office"}: ${clip(m.body, 600)}`).join("\n");
    if (text.length > 22000) text = `${text.slice(0, 6000)}\n[…]\n${text.slice(-16000)}`;
    if (text) parts.push(`THE DOG'S CHAT (oldest first)\n${text}`);
  }
  return { text: parts.join("\n\n"), trainerNotes: notes };
}

const SYSTEM = `You help a dog trainer at Dogwise Academy (a dog board-and-train business) start the handover report for a dog finishing its program. The report goes to the dog's owner. The trainer will read, change and finish everything you write, so give them a solid, true start, not a finished sales piece.

You are given the owner's answers before training, the trainer's intake notes, the weekly health checks and the dog's chat (the trainer's updates and the owner's messages).

${VOICE}

Answer with JSON only:
{"goals":"","training":[{"title":"","text":""}],"homework":[{"title":"","text":""}],"overall":"","extra":"","missing":[""]}

- goals: the owner's main goals for this dog, in their own words where you can (from their answers and messages), 1 to 3 sentences. This is how the owner sees they were listened to.
- training: one item for each skill or behavior that was actually worked on. title: 2 to 4 words. text: what was done and how the dog does with it now, 2 to 4 sentences, with specifics from the updates. Only what the material supports. At most 6.
- homework: what the owner should keep doing at home, one clear instruction per item, based on what still needs work and on their goals. title: 2 to 4 words. text: what to do, how often, and what to watch for, 1 to 3 sentences. At most 5.
- overall: an honest review in 3 to 5 sentences: what went well, what still needs work, what the owner should expect.
- extra: anything else in the material worth telling the owner (equipment, food, routines). Empty string if nothing.
- missing: short notes to the trainer about things you could not find and they should add, for example "Nothing in the chat about recall, which the owner asked for". At most 4.

Never write about the health check at handover, mileage, payment or other dogs. If the material is too thin for a field, leave it empty and say so in missing.`;

const empty = (a: Answers) => !s(a.goals) && !s(a.overall) && !s(a.extra) && !items(a.training).some((i) => i.title || i.text) && !items(a.homework).some((i) => i.title || i.text);
const cleanItems = (v: unknown, max: number): Item[] => items(v).filter((i) => i.text).slice(0, max).map((i) => ({ title: clip(i.title, 60), text: clip(i.text, 900) }));

/** Starts the handover report for one booking, if it's a draft the trainer hasn't written in yet. */
export async function draftHandover(sb: SupabaseClient, b: Booking, trainerName: string): Promise<"drafted" | "skipped" | "thin" | "failed"> {
  const id = await ensureReport(sb, b, trainerName, "handover", 0, false);
  const { data: r } = await sb.from("reports").select("status, answers, ai_draft").eq("id", id).maybeSingle();
  const started = (d: unknown) => !!d && !("tries" in (d as object) && Object.keys(d as object).length === 1); // a real draft (or given up), not just a count of tries
  if (!r || r.status !== "draft" || started(r.ai_draft) || !empty((r.answers || {}) as Answers)) return "skipped";
  const m = await material(sb, b);
  const stamp = { at: new Date().toISOString(), model: writerModel() };
  if (m.trainerNotes < 3) { await sb.from("reports").update({ ai_draft: { fields: {}, missing: [], thin: true, ...stamp } }).eq("id", id); return "thin"; } // not enough to go on: don't guess
  const out = jsonFrom<Fields & { missing?: string[] }>(await claude({ system: SYSTEM, maxTokens: 3500, timeoutMs: 48000,
    user: `Dog: ${b.dog_name || "the dog"}. Owner: ${b.client_name}. Trainer: ${trainerName}. Program: ${(b as { program?: string | null }).program || "board and train"}, ${b.start_date} to ${b.end_date}.\n\n${m.text}` }));
  // Claude didn't answer, or was cut off: one more try on a later run, then the trainer starts it themselves as before
  const tries = Number(((r.ai_draft || {}) as { tries?: number }).tries || 0) + 1;
  if (!out) { await sb.from("reports").update({ ai_draft: tries >= 2 ? { fields: {}, missing: [], failed: true, tries, ...stamp } : { tries } }).eq("id", id).eq("status", "draft"); return "failed"; }
  const fields: Fields = { goals: clip(out.goals, 900), training: cleanItems(out.training, 6), homework: cleanItems(out.homework, 5), overall: clip(out.overall, 1500), extra: clip(out.extra, 900) };
  const has = !!(fields.goals || fields.overall || fields.training?.length || fields.homework?.length);
  if (!has) return "failed";
  // Only into the draft as it still is: the trainer may have started typing while this ran
  const { data: now } = await sb.from("reports").select("status, answers, ai_draft").eq("id", id).maybeSingle();
  if (!now || now.status !== "draft" || started(now.ai_draft) || !empty((now.answers || {}) as Answers)) return "skipped";
  const answers: Answers = { ...((now.answers || {}) as Answers) };
  if (fields.goals) answers.goals = fields.goals;
  if (fields.training?.length) answers.training = fields.training;
  if (fields.homework?.length) answers.homework = fields.homework;
  if (fields.overall) answers.overall = fields.overall;
  if (fields.extra) answers.extra = fields.extra;
  const draft: HandoverDraft = { fields, missing: (out.missing || []).map((x) => clip(x, 200)).filter(Boolean).slice(0, 4), ...stamp };
  const { error } = await sb.from("reports").update({ answers, ai_draft: draft }).eq("id", id).eq("status", "draft");
  if (error) return "failed";
  await pushToTrainer(b.trainer_id, { title: `${b.dog_name || "The dog"}'s handover report is started`, body: "Drafted from your updates and the owner's goals. Check it, change anything, add the health check and send it.", url: `/t/reports/${id}`, tag: `handover-draft-${id}` }).catch(() => 0);
  await auditSystem("Started a handover report", `${b.dog_name || "Dog"} (${b.client_name}), ${trainerName}: drafted from the chat, the owner's answers and the weekly checks.`, { link: `/a/reports/${id}` }).catch(() => null);
  return "drafted";
}

/** The 20-minute forms job: drafts for dogs going home tomorrow, today, or in the last 2 days (until the report is due). */
export async function runHandoverDrafts(sb: SupabaseClient = serviceClient(), now = new Date(), limit = 2) {
  const out = { drafted: 0, thin: 0, errors: [] as string[] };
  try {
    if (!aiOn() || !(await aiSettings(sb)).handoverDrafts) return out;
    const { date: today, hour } = etParts(now);
    // From 5 PM Eastern the evening before, so it's waiting on drop-off day
    const to = hour >= 17 ? addDays(today, 1) : today;
    const { data: bks, error } = await sb.from("bookings").select("*").eq("reports_enabled", true).neq("status", "cancelled").gte("end_date", addDays(today, -2)).lte("end_date", to).order("end_date");
    if (error || !bks?.length) return out;
    const list = (bks as (Booking & { followup_only?: boolean })[]).filter((b) => !b.followup_only);
    const { data: have, error: e } = await sb.from("reports").select("booking_id, status, ai_draft").eq("kind", "handover").in("booking_id", list.map((b) => b.id));
    if (e) return out; // migration 055 not run yet (no ai_draft column)
    const tried = (d: unknown) => !!d && !("tries" in (d as object) && Object.keys(d as object).length === 1);
    const skip = new Set(((have || []) as { booking_id: string; status: string; ai_draft: unknown }[]).filter((r) => r.status !== "draft" || tried(r.ai_draft)).map((r) => r.booking_id));
    const todo = list.filter((b) => !skip.has(b.id)).slice(0, limit);
    if (!todo.length) return out;
    const { data: trs } = await sb.from("trainers").select("id, name").in("id", todo.map((b) => b.trainer_id));
    const name = new Map(((trs || []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
    for (const b of todo) {
      try { const r = await draftHandover(sb, b, name.get(b.trainer_id) || "Trainer"); if (r === "drafted") out.drafted++; else if (r === "thin") out.thin++; }
      catch (err) { out.errors.push(`${b.dog_name || b.id}: ${(err as Error).message}`); }
    }
  } catch (err) { out.errors.push((err as Error).message); }
  return out;
}

// ── What the trainer did with the draft ──
const words = (v: unknown) => (typeof v === "string" ? v : items(v).map((i) => `${i.title} ${i.text}`).join(" ")).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
/** kept (sent as drafted), edited (mostly the draft) or rewritten, for each part the app drafted. */
export function draftResult(draft: HandoverDraft, a: Answers): Record<string, "kept" | "edited" | "rewritten"> {
  const out: Record<string, "kept" | "edited" | "rewritten"> = {};
  for (const k of DRAFT_KEYS) {
    const d = words(draft.fields[k]); if (!d.length) continue;
    const f = words(a[k]);
    if (d.join(" ") === f.join(" ")) { out[k] = "kept"; continue; }
    const set = new Set(f), same = d.filter((w) => set.has(w)).length;
    out[k] = same / Math.max(d.length, f.length || 1) >= 0.6 ? "edited" : "rewritten";
  }
  return out;
}
/** Parts of the form still exactly as drafted (the trainer is asked to confirm they've read them). */
export const untouched = (draft: HandoverDraft | null | undefined, a: Answers) => (draft ? Object.entries(draftResult(draft, a)).filter(([, v]) => v === "kept").map(([k]) => k) : []);

/** For Pulse → Office: drafts made over the range and what trainers did with them. */
export async function handoverDraftStats(sb: SupabaseClient, sinceIso: string) {
  const { data, error } = await sb.from("reports").select("status, ai_draft").eq("kind", "handover").not("ai_draft", "is", null).gte("created_at", sinceIso).limit(2000);
  if (error) return null;
  const rows = ((data || []) as { status: string; ai_draft: HandoverDraft & { thin?: boolean } }[]);
  const made = rows.filter((r) => r.ai_draft.fields && Object.values(r.ai_draft.fields).some((v) => (typeof v === "string" ? v : Array.isArray(v) && v.length))), sent = made.filter((r) => r.ai_draft.result);
  const parts = sent.flatMap((r) => Object.values(r.ai_draft.result || {}));
  const pct = (k: string) => (parts.length ? Math.round((parts.filter((x) => x === k).length / parts.length) * 100) : null);
  return { drafted: made.length, tooThin: rows.filter((r) => r.ai_draft.thin).length, sent: sent.length, keptPct: pct("kept"), editedPct: pct("edited"), rewrittenPct: pct("rewritten") };
}
