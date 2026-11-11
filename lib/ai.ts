import "server-only";

// One place that talks to Claude for the "AI help" features (form checks, handover drafts, update captions).
// Vercel: ANTHROPIC_API_KEY (already used to read client messages). ANTHROPIC_WRITER_MODEL changes the model these use.
export const aiOn = () => !!process.env.ANTHROPIC_API_KEY;
export const writerModel = () => process.env.ANTHROPIC_WRITER_MODEL || "claude-sonnet-5-5";

/** Claude's answer as text, or null (no key, an error, or too slow). Never throws. */
export async function claude(o: { system: string; user: string; maxTokens?: number; timeoutMs?: number; model?: string }): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 25000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: o.model || writerModel(), max_tokens: o.maxTokens || 1200, system: o.system, messages: [{ role: "user", content: o.user }] })
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { content?: { type: string; text?: string }[] };
    return (data.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("").trim() || null;
  } catch { return null; } finally { clearTimeout(timer); }
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
