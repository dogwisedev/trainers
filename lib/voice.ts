import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { VOICE, claude, jsonFrom } from "./ai";
import { Answers, Field, HANDOVER_AFTER, HANDOVER_ROUTE, HANDOVER_SIMPLE, INTAKE_SECTIONS, Item, Kind, WEEKLY_SECTIONS, items, kindName, s } from "./reports";

// "Speak" (migration 056): the trainer talks, the app writes. Two steps, always:
//   1. Speech to text. Normally the phone's own speech recognition, in the browser (components/VoiceButton.tsx): no key,
//      no cost, and only the words reach the server. Optional: with a transcription service set up in Vercel
//      (STT_API_KEY + STT_API_URL for any service that speaks OpenAI's API, or OPENAI_API_KEY; STT_MODEL, STT_LANGUAGE),
//      a recording is transcribed here instead, and not kept.
//   2. Claude tidies what was said: into a short chat message in the person's own way of talking (they send or schedule
//      it themselves), or into the answers of the form they're on (only the questions they talked about), with a few
//      questions back about what's still missing.
// It is never an audio message: nothing spoken reaches a client, only the text the person then sends.

const sttKey = () => process.env.STT_API_KEY || process.env.OPENAI_API_KEY || "";
export const sttOn = () => !!sttKey();
const clip = (v: unknown, n: number) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Speech to text. `names`: the dog's and people's names, so they're spelled right. */
export async function transcribe(audio: Blob, filename: string, names: string[] = []): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!sttOn()) return { ok: false, error: "Speaking isn't switched on yet (OPENAI_API_KEY in Vercel)." };
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", process.env.STT_MODEL || "whisper-1");
  form.append("language", process.env.STT_LANGUAGE || "en");
  form.append("response_format", "json");
  if (names.length) form.append("prompt", `A dog trainer talking about a dog in training. Names: ${names.filter(Boolean).join(", ")}.`);
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 40000);
  try {
    const r = await fetch(process.env.STT_API_URL || "https://api.openai.com/v1/audio/transcriptions", { method: "POST", signal: ctrl.signal, headers: { Authorization: `Bearer ${sttKey()}` }, body: form });
    const body = await r.text();
    if (!r.ok) return { ok: false, error: `Couldn't turn that into text (${r.status}): ${body.slice(0, 200)}` };
    let text = "";
    try { text = String((JSON.parse(body) as { text?: string }).text || ""); } catch { text = body; }
    return { ok: true, text: text.replace(/\s+/g, " ").trim() };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "AbortError" ? "That took too long. Try a shorter one." : (e as Error).message };
  } finally { clearTimeout(timer); }
}

// ── Step 2 for a chat: what they said → a short message in their own voice ──
export async function tailorChat(sb: SupabaseClient, o: { userId: string; role: "trainer" | "admin"; chatId: string; heard: string }): Promise<string | null> {
  const { data: chat } = await sb.from("chats").select("title, client_name").eq("id", o.chatId).maybeSingle();
  const [{ data: mine }, { data: last }] = await Promise.all([
    sb.from("chat_messages").select("body").eq("sender_id", o.userId).eq("sender_role", o.role).not("body", "is", null).order("created_at", { ascending: false }).limit(40),
    sb.from("chat_messages").select("sender_role, sender_id, body").eq("chat_id", o.chatId).in("sender_role", ["trainer", "client", "admin"]).not("body", "is", null).order("created_at", { ascending: false }).limit(6)
  ]);
  const samples = ((mine || []) as { body: string | null }[]).map((m) => clip(m.body, 300)).filter((b) => b.split(" ").length >= 6).slice(0, 8);
  const recent = ((last || []) as { sender_role: string; sender_id: string | null; body: string | null }[]).filter((m) => m.sender_role !== "admin" || m.sender_id).reverse()
    .map((m) => `${m.sender_role === "client" ? "Owner" : m.sender_role === "trainer" ? "Trainer" : "Office"}: ${clip(m.body, 300)}`);
  const out = await claude({ maxTokens: 300, timeoutMs: 15000,
    system: `A ${o.role === "trainer" ? "dog trainer" : "member of the office team"} at Dogwise Academy (a dog board-and-train business) spoke a message for a dog's owner out loud, and it was turned into text. Write it as the chat message they would type: short, in their own way of talking.\n\n${VOICE}\n- Keep what they meant. Drop filler words, false starts, swearing and anything unprofessional. Fix words the speech-to-text clearly got wrong (names especially).\n- Add nothing they didn't say. If they were answering the owner's last message, answer it directly.\n- One to four sentences. Write as them ("I", "we"). No greeting unless they said one, no sign-off.\nAnswer with the message only.`,
    user: `Dog: ${chat?.title || "the dog"}. Owner: ${chat?.client_name || "the owner"}.\n\n${recent.length ? `The last messages in this chat:\n${recent.join("\n")}\n\n` : ""}What they said:\n${clip(o.heard, 3000)}\n\n${samples.length ? `How they write (their recent messages):\n${samples.map((x) => `- ${x}`).join("\n")}` : "No earlier messages from them."}` });
  return (out || "").replace(/^["“]|["”]$/g, "").trim() || null;
}

// ── Step 2 for a form: what they said → the answers it's about, and what to ask next ──
type Q = { key: string; label: string; type: Field["type"] | "items"; options?: string[]; required: boolean; detail?: boolean };
/** The questions of a form, as the app asks them. */
export function formQuestions(kind: Kind): Q[] {
  const f = (x: Field): Q => ({ key: x.key, label: x.label, type: x.type, options: "options" in x ? x.options : undefined, required: "required" in x && !!x.required, detail: x.type === "yesno" && (x.detail ?? "yes") !== "none" });
  if (kind === "weekly") return WEEKLY_SECTIONS.flatMap((x) => x.fields).map(f);
  if (kind === "intake") return INTAKE_SECTIONS.flatMap((x) => x.fields).map(f);
  return [...HANDOVER_SIMPLE.map(f), { key: "training", label: "Training items: each thing that was worked on, with what was done and how the dog does now", type: "items", required: true },
    { key: "homework", label: "Homework items: clear directions for the owner to keep up at home", type: "items", required: true }, ...HANDOVER_AFTER.map(f), ...HANDOVER_ROUTE.map(f)];
}

export type FormFill = { set: Answers; filled: string[]; questions: string[] };
/** Keeps only answers that fit the form: known questions, real options, sensible values. */
export function cleanFill(kind: Kind, raw: Record<string, unknown>): { set: Answers; filled: string[] } {
  const set: Answers = {}, filled: string[] = [];
  for (const q of formQuestions(kind)) {
    const v = raw[q.key];
    const put = (val: unknown) => { set[q.key] = val; filled.push(q.label.split(":")[0].split("?")[0].slice(0, 60)); };
    if (q.type === "yesno") {
      const yn = String(v ?? "").toLowerCase();
      if (yn === "yes" || yn === "no") put(yn);
      const d = raw[`${q.key}_detail`];
      if (q.detail && typeof d === "string" && d.trim()) { set[`${q.key}_detail`] = clip(d, 1500); if (set[q.key] === undefined) filled.push(`${q.label.split(":")[0].split("?")[0].slice(0, 50)} (detail)`); }
    } else if (v === undefined || v === null || v === "") continue;
    else if (q.type === "single") { const hit = (q.options || []).find((o) => o.toLowerCase() === String(v).trim().toLowerCase()); if (hit) put(hit); }
    else if (q.type === "multi") { const hits = (Array.isArray(v) ? v : [v]).map((x) => (q.options || []).find((o) => o.toLowerCase() === String(x).trim().toLowerCase())).filter(Boolean); if (hits.length) put(hits); }
    else if (q.type === "number") { const n = Number(String(v).replace(/[^\d.]/g, "")); if (Number.isFinite(n) && String(v).match(/\d/) && n <= 2000) put(String(n)); }
    else if (q.type === "date") { if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) put(String(v)); }
    else if (q.type === "items") { const list: Item[] = items(v).filter((i) => i.text).slice(0, 8).map((i) => ({ title: clip(i.title, 60), text: clip(i.text, 1200) })); if (list.length) put(list); }
    else if (q.type === "text" || q.type === "textarea") { if (typeof v === "string" && v.trim()) put(clip(v, q.type === "text" ? 300 : 2500)); }
    // "confirm" boxes are never ticked for anyone
  }
  return { set, filled };
}

export async function fillForm(o: { kind: Kind; week?: number; dog: string; answers: Answers; heard: string; today: string }): Promise<FormFill | null> {
  const qs = formQuestions(o.kind);
  const now: Record<string, unknown> = {};
  for (const q of qs) { const v = o.answers[q.key]; if (v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) now[q.key] = v; if (s(o.answers[`${q.key}_detail`])) now[`${q.key}_detail`] = o.answers[`${q.key}_detail`]; }
  const out = jsonFrom<{ set?: Record<string, unknown>; questions?: string[] }>(await claude({ maxTokens: 2200, timeoutMs: 30000,
    system: `A dog trainer at Dogwise Academy (a dog board-and-train business) is filling in a form by talking through it. You get the form's questions, the answers so far, and what the trainer just said (speech turned into text: expect filler words and a few mis-heard words). Fill in only what they actually said.

Rules:
- Never guess. Never answer a question they didn't talk about, and never mark a health question "no" unless they said that part is fine.
- yesno: "yes" or "no". When the answer needs describing (marked "needs detail"), also set "<key>_detail" with what they said about it.
- single: exactly one of the options. multi: a list of options. number: digits only. date: YYYY-MM-DD (today is ${o.today}).
- text and textarea: their words, tidied into clear sentences. If the question already has an answer and they added to it, give the combined answer.
- items: the full list for that key, as [{"title":"2 to 4 words","text":"..."}]. Keep the items already there (improved only if they added to them) and add the new ones they described.
- questions: up to 4 short questions to ask the trainer next, speaking to them directly: required questions still unanswered after this (most important first), or something they said that needs a detail ("You said he's limping: which leg, and since when?"). Empty if nothing is needed.

${VOICE}
- Remove swearing and anything unprofessional. Fix names and words the speech-to-text clearly got wrong.

Answer with JSON only: {"set":{"<key>":<value>},"questions":["..."]}`,
    user: `Form: ${kindName(o.kind)}${o.kind === "weekly" && o.week ? ` (week ${o.week})` : ""} for ${o.dog || "the dog"}.\n\nThe questions:\n${qs.map((q) => `- ${q.key} [${q.type}${q.options ? `: ${q.options.join(" | ")}` : ""}${q.required ? ", required" : ""}${q.detail ? ", needs detail" : ""}]: ${q.label}`).join("\n")}\n\nAnswers so far:\n${JSON.stringify(now).slice(0, 9000)}\n\nWhat the trainer just said:\n${clip(o.heard, 6000)}` }));
  if (!out) return null;
  const { set, filled } = cleanFill(o.kind, (out.set || {}) as Record<string, unknown>);
  return { set, filled, questions: (out.questions || []).map((q) => clip(q, 220)).filter(Boolean).slice(0, 4) };
}
