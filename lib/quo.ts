import "server-only";

// Texts from a Dogwise Quo number, through Quo's API. Vercel variables:
//   QUO_API_KEY   the API key (Quo workspace settings → API)
//   QUO_FROM      the default Quo number texts come from: its ID (PN…) or +1XXXXXXXXXX. Quo says every number in the
//                 workspace can text US numbers (carrier registration approved); /api/quo/test confirms it for yours.
//   QUO_FROM_BY_POC  optional: each Point of Contact's own Quo number, so a trainer's texts come from their POC's
//                 number and the trainer's replies land in that POC's Quo inbox. JSON, POC name → Quo number ID (PN…)
//                 or +1XXXXXXXXXX, e.g. {"Emmalee Camargo":"PNhk6l4DYO","Anita Oliveira":"PNG34GY5lv"}. Matched to the
//                 POC on the trainer's profile by full name or first name; anyone else gets QUO_FROM.
//   QUO_API_URL   optional, default https://api.openphone.com/v1 (Quo was OpenPhone)
// Without the key, nothing is texted and reminders fall back to email. Never throws.
export const quoConfigured = () => !!(process.env.QUO_API_KEY && (process.env.QUO_FROM || pocNumbers().size));

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** QUO_FROM_BY_POC as a map (empty when it isn't set or isn't valid JSON). */
export function pocNumbers(): Map<string, string> {
  try {
    const o = JSON.parse(process.env.QUO_FROM_BY_POC || "{}") as Record<string, unknown>;
    return new Map(Object.entries(o).filter(([k, v]) => k.trim() && typeof v === "string" && v.trim()).map(([k, v]) => [k.trim(), (v as string).trim()]));
  } catch { return new Map(); }
}
/** The number a trainer's texts come from: their POC's, if it's in QUO_FROM_BY_POC, else QUO_FROM. */
export function fromFor(poc: string | null | undefined): { from: string | null; via: "poc" | "default" | "none"; poc: string | null } {
  const p = norm(String(poc || ""));
  if (p) for (const [name, num] of pocNumbers()) {
    const n = norm(name);
    if (n === p || n.split(" ")[0] === p.split(" ")[0]) return { from: num, via: "poc", poc: name };
  }
  const d = (process.env.QUO_FROM || "").trim();
  return { from: d || null, via: d ? "default" : "none", poc: null };
}
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

/** Sends one text, from `from` (a POC's number) or QUO_FROM. Quo's answer comes back as it is when it fails, so the test page can show it. */
export async function sendText(to: string, content: string, from?: string | null): Promise<TextResult> {
  if (!quoConfigured()) return { ok: false, error: "Quo isn't set up (QUO_API_KEY and QUO_FROM in Vercel)." };
  const sender = (from || process.env.QUO_FROM || "").trim();
  if (!sender) return { ok: false, error: "No Quo number to text from: set QUO_FROM, or this POC's number in QUO_FROM_BY_POC." };
  const number = toE164(to);
  if (!number) return { ok: false, error: `"${to}" isn't a US phone number.` };
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(`${base()}/messages`, {
      method: "POST", signal: ctrl.signal,
      headers: { Authorization: process.env.QUO_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1500), from: sender, to: [number] })
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
