import "server-only";

// One place that talks to Claude for the app's AI help (reading client messages, form checks, handover drafts, update
// captions, Speak). Vercel: ANTHROPIC_API_KEY. The model is picked by itself: the newest name first, then older ones if
// this account doesn't have it (ANTHROPIC_WRITER_MODEL / ANTHROPIC_MODEL put your own choice first). When a call fails,
// the reason is kept (aiLastError) and /api/ai/test shows exactly what Claude answered, instead of failing silently.
export const aiOn = () => !!process.env.ANTHROPIC_API_KEY;
const MODELS = {
  writer: () => [process.env.ANTHROPIC_WRITER_MODEL, "claude-sonnet-5-5", "claude-sonnet-4-6", "claude-sonnet-4-5"],   // writing and judging
  fast: () => [process.env.ANTHROPIC_MODEL, "claude-haiku-5-5", "claude-haiku-4-5"]                                     // labelling messages
};
type Family = keyof typeof MODELS;
const works: Partial<Record<Family, string>> = {};  // the model that answered last time, tried first
const order = (f: Family) => [...new Set([works[f], ...MODELS[f]()].map((m) => (m || "").trim()).filter(Boolean))];
export const writerModel = () => works.writer || order("writer")[0];

export type AiError = { at: string; model: string; status: number; message: string };
let lastError: AiError | null = null;
/** Why the last call to Claude failed (in this server instance), or null. */
export const aiLastError = () => lastError;
/** The error in plain words, for an admin. */
export const aiErrorText = (e: AiError | null) => !e ? "" : e.status === 401 ? "Claude didn't accept the API key (check ANTHROPIC_API_KEY in Vercel)."
  : /credit balance|billing/i.test(e.message) ? "The Claude account has no credit: add a payment method or credits in the Claude Console."
  : e.status === 404 ? `Claude doesn't know the model "${e.model}" on this account.`
  : e.status === 429 ? "Claude is rate-limiting this account just now." : e.status === 0 ? `Claude didn't answer (${e.message}).` : `Claude answered ${e.status}: ${e.message}`;

type CallResult = { ok: true; text: string } | { ok: false; status: number; message: string };
type Ask = { system: string; user: string; maxTokens?: number; timeoutMs?: number };
// Newer models think before they answer, and that thinking comes out of the same word budget: a short budget can be used
// up before any answer is written (the answer comes back empty). These are quick jobs, so thinking is switched off; a
// model that won't take that setting is asked without it, with more room. An answer that still comes back empty because
// it ran out of room is asked for once more with a lot more room.
const noThinkingSetting = new Set<string>(); // models that refused the "thinking off" setting
async function post(model: string, o: Ask, maxTokens: number, thinkingOff: boolean): Promise<CallResult & { stop?: string; ranOut?: boolean; refusedSetting?: boolean }> {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 25000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: o.system, messages: [{ role: "user", content: o.user }], ...(thinkingOff ? { thinking: { type: "disabled" } } : {}) })
    });
    const body = await r.text();
    if (!r.ok) {
      let message = body.slice(0, 300);
      try { message = (JSON.parse(body) as { error?: { message?: string } }).error?.message || message; } catch { /* not JSON */ }
      return { ok: false, status: r.status, message, refusedSetting: thinkingOff && r.status === 400 && /thinking/i.test(message) };
    }
    const data = JSON.parse(body) as { content?: { type: string; text?: string }[]; stop_reason?: string };
    const blocks = data.content || [], text = blocks.filter((c) => c.type === "text").map((c) => c.text || "").join("").trim();
    if (text) return { ok: true, text };
    const stop = data.stop_reason || "unknown";
    return { ok: false, status: r.status, stop, ranOut: stop === "max_tokens",
      message: stop === "refusal" ? "Claude declined to write this one." : `No text in the answer (it stopped with "${stop}"; it contained: ${blocks.map((c) => c.type).join(", ") || "nothing"}).` };
  } catch (e) {
    return { ok: false, status: 0, message: (e as Error).name === "AbortError" ? "it took too long" : (e as Error).message };
  } finally { clearTimeout(timer); }
}
async function call(model: string, o: Ask): Promise<CallResult> {
  const want = o.maxTokens || 1200;
  let off = !noThinkingSetting.has(model);
  let r = await post(model, o, off ? want : Math.max(4000, want * 4), off);
  if (r.ok) return r;
  if (r.refusedSetting) { noThinkingSetting.add(model); off = false; r = await post(model, o, Math.max(4000, want * 4), false); if (r.ok) return r; }
  if (r.ranOut) { const again = await post(model, o, Math.min(16000, Math.max(6000, want * 8)), off); if (again.ok) return again; r = again; }
  return { ok: false, status: r.status, message: r.message };
}

/** Claude's answer as text, or null (no key, an error, or too slow: see aiLastError). Never throws. `fast`: the small model. */
export async function claude(o: { system: string; user: string; maxTokens?: number; timeoutMs?: number; fast?: boolean }): Promise<string | null> {
  if (!aiOn()) return null;
  const family: Family = o.fast ? "fast" : "writer";
  for (const model of order(family)) {
    const r = await call(model, o);
    if (r.ok) { works[family] = model; lastError = null; return r.text; }
    lastError = { at: new Date().toISOString(), model, status: r.status, message: r.message };
    // Only a model this account doesn't have is worth trying the next name for; anything else (key, credit, timeout) is the same for all
    if (!(r.status === 404 || (r.status === 400 && /model/i.test(r.message)))) break;
  }
  return null;
}

/** For /api/ai/test: one tiny question to each kind of model, with exactly what came back. */
export async function aiTest() {
  const one = async (family: Family) => {
    const tried: { model: string; ok: boolean; status?: number; answer?: string; error?: string }[] = [];
    for (const model of order(family)) {
      const r = await call(model, { system: "Answer with the single word OK.", user: "Are you there?", maxTokens: 10, timeoutMs: 15000 });
      tried.push(r.ok ? { model, ok: true, answer: r.text } : { model, ok: false, status: r.status, error: r.message });
      if (r.ok) { works[family] = model; break; }
      if (!(r.status === 404 || (r.status === 400 && /model/i.test(r.message)))) break;
    }
    return { working: tried.find((t) => t.ok)?.model || null, tried };
  };
  const writing = await one("writer"), labelling = await one("fast");
  // A real job, like Speak's tidy-up: a one-word answer can work while a real one comes back empty
  let tidyUp: { ok: boolean; answer?: string; error?: string } = { ok: false, error: "Not tried: no model answered." };
  if (writing.working) {
    const t = await call(writing.working, { maxTokens: 300, timeoutMs: 20000, system: `${VOICE}\nTurn what the dog trainer said out loud into the short chat message they would type to the dog's owner. Drop filler words and swearing. Answer with the message only.`,
      user: "um so yeah Jax did really good today on the uh leash, damn potatoes, he still pulls a bit near other dogs but yeah good day" });
    tidyUp = t.ok ? { ok: true, answer: t.text } : { ok: false, error: `${t.status}: ${t.message}` };
  }
  return { keySet: aiOn(), writing, labelling, tidyUp };
}

/** The JSON object or array in Claude's answer (fences and stray words around it are ignored), or null. */
export function jsonFrom<T>(text: string | null): T | null {
  if (!text) return null;
  const t = text.replace(/```json|```/g, "");
  const a = t.indexOf("{"), b = t.indexOf("[");
  const start = a < 0 ? b : b < 0 ? a : Math.min(a, b);
  if (start < 0) return null;
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  try { return JSON.parse(t.slice(start, end + 1)) as T; } catch { return null; }
}

/** The writing rules every piece of AI text follows: a trainer's plain voice, facts only, nothing invented. */
export const VOICE = `Writing rules:
- Write the way a good dog trainer talks to a client: plain, warm, specific. Short sentences. US English.
- Use only what is in the material you are given. Never invent a behavior, a number, an incident or progress that isn't there.
- Reuse the trainer's own words and phrases where you can.
- No promises or guarantees ("fully trained", "cured", "will never"). Say what the dog can do now and what still needs work.
- No filler or marketing language (no "journey", "transformation", "amazing progress", "we are thrilled"). No exclamation marks unless the trainer uses them.
- No emoji unless the trainer's own messages use them. No headings or bullet symbols inside a text field.`;
