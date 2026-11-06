import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";

// Texts from a Dogwise Quo number, through Quo's API. Vercel variables:
//   QUO_API_KEY   the API key (Quo workspace settings → API)
//   QUO_FROM      the default Quo number texts come from: its ID (PN…) or +1XXXXXXXXXX
//   QUO_API_URL   optional, default https://api.openphone.com/v1 (Quo was OpenPhone)
// Each admin can set their own Quo number on Your account (migration 051): texts to the trainers they're Point of Contact
// for come from it, so those trainers' replies land in their Quo inbox. Everyone else's come from QUO_FROM.
// Without the key, nothing is texted and reminders fall back to email. Never throws.
export const quoConfigured = () => !!process.env.QUO_API_KEY;

/** A Quo number as typed on Your account: a number ID (PN…) as it is, or a phone number as +1XXXXXXXXXX; null if neither. */
export function quoNumber(input: string | null | undefined): string | null {
  const s = String(input || "").trim();
  if (/^PN[A-Za-z0-9]{4,}$/.test(s)) return s;
  return toE164(s);
}
export type PocNumbers = Map<string, { number: string; admin: string }>;
/** Each admin's Quo number, by the trainer POC name they answer to (lowercase). Empty before migration 051. */
export async function loadPocNumbers(sb: SupabaseClient = serviceClient()): Promise<PocNumbers> {
  const { data, error } = await sb.from("profiles").select("display_name, quo_number, quo_poc").eq("role", "admin").not("quo_number", "is", null);
  if (error) return new Map();
  const out: PocNumbers = new Map();
  for (const p of (data || []) as { display_name: string | null; quo_number: string; quo_poc: string | null }[]) {
    const poc = (p.quo_poc || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (poc && p.quo_number) out.set(poc, { number: p.quo_number, admin: p.display_name || "an admin" });
  }
  return out;
}
/** The number a trainer's texts come from: their POC's own Quo number, else QUO_FROM. */
export function fromFor(poc: string | null | undefined, nums: PocNumbers): { from: string | null; via: "poc" | "default" | "none"; admin: string | null } {
  const hit = nums.get(String(poc || "").replace(/\s+/g, " ").trim().toLowerCase());
  if (hit) return { from: hit.number, via: "poc", admin: hit.admin };
  const d = (process.env.QUO_FROM || "").trim();
  return { from: d || null, via: d ? "default" : "none", admin: null };
}
const base = () => (process.env.QUO_API_URL || "https://api.openphone.com/v1").replace(/\/$/, "");

/** "(518) 400-5674" → "+15184005674". US numbers only; null when it doesn't look like one. */
export function toE164(phone: string | null | undefined): string | null {
  // The first phone number in the text ("Personal: 206-507-1253\nWork: 321-914-5917" → the personal one)
  const raw = (String(phone || "").match(/\+?\d[\d\s().-]{8,}\d/) || [""])[0].trim();
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
  if (!sender) return { ok: false, error: "No Quo number to text from: set QUO_FROM in Vercel, or the POC's own number on their account page." };
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
