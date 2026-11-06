import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { answeredUpTo } from "./chatRules";

// Who has to act on each client message (migration 052), so only real questions chase the trainer:
//   reply   the trainer answers it: a question or request about the dog, pickup, training
//   office  the office answers it: payment, dates, refunds, contracts, or it's written to someone else
//   none    nothing to answer: "Yes, that's perfect", thanks, an emoji, a goodbye
//   urgent  a person, now: a bite, an injury, illness, an escape, an upset client
// The 10-minute chat check labels new client messages (Claude with ANTHROPIC_API_KEY, simple rules without), then:
// only reply / urgent / not-yet-labelled messages count as "waiting" for the trainer; office ones go on To do for the
// office until someone in the office answers in the chat (or taps Handled); urgent ones go on To do straight away.
// CLIENT_NEEDS=off in Vercel goes back to "the client spoke last = waiting".

export type Needs = "reply" | "office" | "none" | "urgent";
export type Flag = { id: string; at: string; body: string; why: string | null };
type Msg = { id: string; chat_id: string; created_at: string; sender_role: string; sender_name: string | null; sender_id: string | null; body: string | null; kind: string };
type ChatLike = { id: string; last_reply_at?: string | null; last_trainer_at?: string | null; last_admin_at?: string | null; reply_waived_at?: string | null };

export const needsOn = () => (process.env.CLIENT_NEEDS || "").trim().toLowerCase() !== "off";
const ms = (v: string | null | undefined) => (v ? Date.parse(v) : 0);
const clip = (s: string | null | undefined, n: number) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const NEEDS: Needs[] = ["reply", "office", "none", "urgent"];

// ── Rules: without an API key, or when Claude doesn't answer ──
const URGENT_RE = /\b(bit|bites?|bitten|biting|attack(ed|ing)?|injur(y|ed|ies)|bleed(ing)?|blood|vomit(ing|ed)?|threw up|throwing up|diarrh?o?ea|limp(ing)?|emergency|hospital|escaped|ran away|seizures?|swollen|unhappy|disappointed|upset|angry|furious|unacceptable|complain(t|ing)?|lawyer|chargeback)\b/i;
const OFFICE_RE = /(\$\s?\d|\b\d{2,}\.\d{2}\b|\b(pay|paid|paying|payment|invoice|charged?|card|deposit|balance|price|cost|discount|financ\w*|installments?|receipt|refund|cancel\w*|reschedul\w*|postpone|extension|contract|certificate)\b)/i;
const ACK_RE = /^(yes|yeah|yep|yup|ok(ay)?|k|sure|perfect|great|awesome|amazing|wonderful|cool|nice|lovely|good|sounds (good|great|perfect)|will do|got it|noted|thanks?|thank you|thx|ty|appreciate|see you|bye|have a (good|great|nice)|love (it|this|that)|so cute|aww+|haha+|lol)\b/i;
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s!.]+$/u;
export function ruleNeeds(body: string | null, kind: string): { needs: Needs; why: string } {
  const t = String(body || "").replace(/\s+/g, " ").trim();
  if (!t) return { needs: "none", why: kind === "media" ? "A photo or file" : "Nothing written" };
  if (URGENT_RE.test(t)) return { needs: "urgent", why: "Health, safety or an unhappy client" };
  if (OFFICE_RE.test(t)) return { needs: "office", why: "Payment, dates or booking" };
  if (EMOJI_ONLY.test(t)) return { needs: "none", why: "Just an emoji" };
  if (!t.includes("?") && t.split(" ").length <= 8 && ACK_RE.test(t)) return { needs: "none", why: "Thanks or an OK" };
  return { needs: "reply", why: t.includes("?") ? "A question for the trainer" : "For the trainer to answer" };
}

// ── Claude ──
const SYSTEM = `You read a chat between a client of Dogwise Academy (a dog board-and-train business), their dog's trainer and the Dogwise office. For each client message you're asked about, decide who has to act on it:
- reply: the trainer should answer it (a question or request about the dog, pickup or drop-off logistics, training, or news that deserves a response).
- office: the office should answer it, not the trainer (payment, prices, invoices, deposits, refunds, cancelling or changing dates, contracts, certificates, or a message written to someone other than the trainer).
- none: nothing needs answering (thanks, an OK, a yes to something already arranged, an emoji, a goodbye, a message that closes the conversation).
- urgent: a person must act now (a bite or attack, an injury, illness, the dog escaped or is lost, a client who is upset, complaining or threatening to cancel).
Judge each message in the conversation's context: "Yes, that's perfect" answering the trainer's question is none. When a message is both, the order is urgent, then office, then reply.
Answer with JSON only, no other text: [{"ref":"<ref>","needs":"reply|office|none|urgent","why":"<under 8 words>"}]`;
const who = (m: Msg) => m.sender_role === "client" ? `Client${m.sender_name ? ` (${m.sender_name})` : ""}` : m.sender_role === "trainer" ? `Trainer${m.sender_name ? ` (${m.sender_name})` : ""}` : m.sender_role === "admin" && m.sender_id ? "Office" : "App (automatic)";

async function aiNeeds(context: Msg[], targets: Msg[]): Promise<Map<string, { needs: Needs; why: string }> | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const ref = (m: Msg) => m.id.slice(0, 8);
  const transcript = context.map((m) => `[${ref(m)}] ${new Date(m.created_at).toISOString().slice(0, 16).replace("T", " ")} ${who(m)}: ${m.body ? clip(m.body, 600) : m.kind === "media" ? "(a photo, video or file)" : "(no text)"}`).join("\n");
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 600, system: SYSTEM,
        messages: [{ role: "user", content: `The chat, oldest first:\n${transcript}\n\nThe client messages to decide: ${targets.map(ref).join(", ")}` }] })
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("").replace(/```json|```/g, "").trim();
    const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as { ref: string; needs: string; why?: string }[];
    const out = new Map<string, { needs: Needs; why: string }>();
    for (const x of arr) {
      const m = targets.find((t) => ref(t) === x.ref);
      if (m && NEEDS.includes(x.needs as Needs)) out.set(m.id, { needs: x.needs as Needs, why: clip(x.why || "", 120) });
    }
    return out;
  } catch { return null; } finally { clearTimeout(timer); }
}

/** The 10-minute chat check: labels client messages from the last 7 days that don't have one yet (up to 40 a run). Never throws. */
export async function classifyNew(sb: SupabaseClient = serviceClient(), now = new Date()) {
  const out = { labelled: 0, byClaude: 0, errors: [] as string[] };
  if (!needsOn()) return out;
  try {
    const since = new Date(now.getTime() - 7 * 864e5).toISOString();
    const { data: recent, error } = await sb.from("chat_messages").select("id, chat_id, created_at, sender_role, sender_name, sender_id, body, kind").eq("sender_role", "client").gte("created_at", since).order("created_at", { ascending: false }).limit(300);
    if (error) { out.errors.push(error.message); return out; }
    const msgs = (recent || []) as Msg[];
    const have = new Set<string>();
    for (let i = 0; i < msgs.length; i += 100) {
      const { data, error: e } = await sb.from("message_needs").select("message_id").in("message_id", msgs.slice(i, i + 100).map((m) => m.id));
      if (e) return out; // migration 052 not run yet: nothing to do
      for (const x of (data || []) as { message_id: string }[]) have.add(x.message_id);
    }
    const todo = msgs.filter((m) => !have.has(m.id)).slice(0, 40);
    const byChat = new Map<string, Msg[]>();
    for (const m of todo) byChat.set(m.chat_id, [...(byChat.get(m.chat_id) || []), m]);
    for (const [chatId, targets] of byChat) {
      const newest = targets.reduce((a, m) => (m.created_at > a ? m.created_at : a), targets[0].created_at);
      const { data: ctx } = await sb.from("chat_messages").select("id, chat_id, created_at, sender_role, sender_name, sender_id, body, kind").eq("chat_id", chatId).lte("created_at", newest).order("created_at", { ascending: false }).limit(16);
      const context = ((ctx || []) as Msg[]).reverse();
      const ai = await aiNeeds(context, targets);
      const rows = targets.map((t) => {
        const r = ai?.get(t.id) || ruleNeeds(t.body, t.kind);
        return { message_id: t.id, chat_id: chatId, sent_at: t.created_at, needs: r.needs, why: r.why, by: ai?.has(t.id) ? "ai" : "rules", first: r.needs };
      });
      const { error: e } = await sb.from("message_needs").upsert(rows, { onConflict: "message_id", ignoreDuplicates: true });
      if (e) { out.errors.push(e.message); continue; }
      out.labelled += rows.length; out.byClaude += rows.filter((r) => r.by === "ai").length;
    }
  } catch (e) { out.errors.push((e as Error).message); }
  return out;
}

/** The client's messages since `after` that need the trainer: reply, urgent, or not labelled yet (off or before 052: all of them). */
export async function pendingFor(sb: SupabaseClient, chatId: string, after: string | null): Promise<{ id: string; created_at: string; body: string | null; kind: string }[]> {
  const { data } = await sb.from("chat_messages").select("id, created_at, body, kind").eq("chat_id", chatId).eq("sender_role", "client").gt("created_at", after || "1970-01-01T00:00:00Z").order("created_at").limit(30);
  const msgs = (data || []) as { id: string; created_at: string; body: string | null; kind: string }[];
  return dropNotForTrainer(sb, msgs);
}
/** Leaves out messages labelled none or office. */
export async function dropNotForTrainer<T extends { id: string }>(sb: SupabaseClient, msgs: T[]): Promise<T[]> {
  if (!msgs.length || !needsOn()) return msgs;
  const { data, error } = await sb.from("message_needs").select("message_id, needs").in("message_id", msgs.map((m) => m.id));
  if (error) return msgs;
  const skip = new Set(((data || []) as { message_id: string; needs: Needs }[]).filter((x) => x.needs === "none" || x.needs === "office").map((x) => x.message_id));
  return msgs.filter((m) => !skip.has(m.id));
}

/** Office questions nobody in the office has answered in the chat, and urgent messages nobody has answered, per chat (last 14 days). */
export async function openFlags(sb: SupabaseClient, chats: ChatLike[], now = new Date()): Promise<Map<string, { office: Flag[]; urgent: Flag[] }>> {
  const out = new Map<string, { office: Flag[]; urgent: Flag[] }>();
  if (!needsOn() || !chats.length) return out;
  const since = new Date(now.getTime() - 14 * 864e5).toISOString();
  const { data, error } = await sb.from("message_needs").select("message_id, chat_id, sent_at, needs, why").in("needs", ["office", "urgent"]).is("handled_at", null).gte("sent_at", since);
  if (error) return out;
  const open = new Map(chats.map((c) => [c.id, c]));
  const rows = ((data || []) as { message_id: string; chat_id: string; sent_at: string; needs: Needs; why: string | null }[]).filter((r) => open.has(r.chat_id));
  if (!rows.length) return out;
  const bodies = new Map<string, string>();
  for (let i = 0; i < rows.length; i += 100) {
    const { data: b } = await sb.from("chat_messages").select("id, body").in("id", rows.slice(i, i + 100).map((r) => r.message_id));
    for (const x of (b || []) as { id: string; body: string | null }[]) bodies.set(x.id, x.body || "(a photo or file)");
  }
  // The office's own replies (a signed-in admin, not the app's automatic posts), for the chats with an office question
  const officeChats = [...new Set(rows.filter((r) => r.needs === "office").map((r) => r.chat_id))];
  const officeAt = new Map<string, number>();
  for (const id of officeChats) {
    const first = rows.filter((r) => r.chat_id === id && r.needs === "office").reduce((a, r) => (r.sent_at < a ? r.sent_at : a), now.toISOString());
    const { data: o } = await sb.from("chat_messages").select("created_at").eq("chat_id", id).eq("sender_role", "admin").not("sender_id", "is", null).gt("created_at", first).order("created_at", { ascending: false }).limit(1);
    const last = (o as { created_at: string }[] | null)?.[0]?.created_at; if (last) officeAt.set(id, ms(last));
  }
  for (const r of rows) {
    const c = open.get(r.chat_id)!;
    const answered = r.needs === "office" ? (officeAt.get(r.chat_id) || 0) > ms(r.sent_at) || ms(c.reply_waived_at) > ms(r.sent_at) : ms(answeredUpTo(c)) > ms(r.sent_at);
    if (answered) continue;
    const slot = out.get(r.chat_id) || { office: [], urgent: [] };
    slot[r.needs === "office" ? "office" : "urgent"].push({ id: r.message_id, at: r.sent_at, body: bodies.get(r.message_id) || "", why: r.why });
    out.set(r.chat_id, slot);
  }
  return out;
}

/** How the labelling is doing, for Claude's reminders report: labels by kind, and how many people changed. */
export async function needsStats(sb: SupabaseClient, sinceIso: string) {
  const { data, error } = await sb.from("message_needs").select("needs, first, by").gte("sent_at", sinceIso).limit(5000);
  if (error) return null;
  const rows = (data || []) as { needs: Needs; first: Needs | null; by: string }[];
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  return {
    labelled: rows.length, byClaude: count((r) => r.by === "ai"), byRules: count((r) => r.by === "rules"),
    reply: count((r) => r.needs === "reply"), office: count((r) => r.needs === "office"), none: count((r) => r.needs === "none"), urgent: count((r) => r.needs === "urgent"),
    changedByPeople: count((r) => !!r.first && r.first !== r.needs)
  };
}
