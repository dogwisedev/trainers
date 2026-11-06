import "server-only";

// Texts from a Dogwise Quo number, through Quo's API. Vercel variables:
//   QUO_API_KEY   the API key (Quo workspace settings → API)
//   QUO_FROM      the Quo number texts come from, as +1XXXXXXXXXX (a local number: the workspace's carrier
//                 registration covers local numbers; a toll-free number needs its own verification)
//   QUO_API_URL   optional, default https://api.openphone.com/v1 (Quo was OpenPhone)
// Without the key, nothing is texted and reminders fall back to email. Never throws.
export const quoConfigured = () => !!(process.env.QUO_API_KEY && process.env.QUO_FROM);
const base = () => (process.env.QUO_API_URL || "https://api.openphone.com/v1").replace(/\/$/, "");

/** "(518) 400-5674" → "+15184005674". US numbers only; null when it doesn't look like one. */
export function toE164(phone: string | null | undefined): string | null {
  const raw = String(phone || "").trim();
  const d = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && d.length >= 11 && d.length <= 15) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export type TextResult = { ok: boolean; id?: string; status?: number; error?: string };

/** Sends one text. The answer from Quo comes back as it is when it fails, so the test page can show it. */
export async function sendText(to: string, content: string): Promise<TextResult> {
  if (!quoConfigured()) return { ok: false, error: "Quo isn't set up (QUO_API_KEY and QUO_FROM in Vercel)." };
  const number = toE164(to);
  if (!number) return { ok: false, error: `"${to}" isn't a US phone number.` };
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(`${base()}/messages`, {
      method: "POST", signal: ctrl.signal,
      headers: { Authorization: process.env.QUO_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1500), from: process.env.QUO_FROM!.trim(), to: [number] })
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, status: r.status, error: text.slice(0, 400) || r.statusText };
    let id: string | undefined;
    try { id = (JSON.parse(text) as { data?: { id?: string } }).data?.id; } catch { /* fine: it was sent */ }
    return { ok: true, status: r.status, id };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "AbortError" ? "Quo didn't answer within 10 seconds." : (e as Error).message };
  } finally { clearTimeout(timer); }
}
