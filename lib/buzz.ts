import "server-only";

// Buzz, side by side with Slack. Each Buzz channel has a workflow with a Webhook trigger and one "Send message" step whose
// text is exactly {{trigger.message}}. The app POSTs {"message": "..."} to the workflow's /hooks URL with the secret in a header.
// No keys, no accounts. Off until both variables of a room are set; a Buzz problem never stops or slows anything else.
// Vercel variables (each pair from the workflow's webhook dialog; the secret is shown once):
//   BUZZ_OFFICE_URL, BUZZ_OFFICE_SECRET       the app's admin alerts (the same ones that go to admins' phones)
//   BUZZ_PAYMENTS_URL, BUZZ_PAYMENTS_SECRET   Stripe payments, paid and failed
export type BuzzRoom = "office" | "payments";

const envOf = (room: BuzzRoom) => {
  const key = room.toUpperCase();
  return { url: (process.env[`BUZZ_${key}_URL`] || "").trim(), secret: (process.env[`BUZZ_${key}_SECRET`] || "").trim() };
};
export const buzzOn = (room: BuzzRoom) => { const e = envOf(room); return !!(e.url && e.secret); };

/** Markdown-safe text for names, notes and anything a person typed (Buzz renders messages as Markdown). */
export const md = (s: unknown) => String(s ?? "").replace(/[\\`*_[\]<>|~#]/g, (c) => `\\${c}`).replace(/\s+/g, " ").trim();
/** A Markdown link; the label is escaped, the URL must be absolute https (anything else is shown as plain text). */
export const mdLink = (label: string, url: string | null | undefined) => (url && /^https:\/\//.test(url) ? `[${md(label)}](${url.replace(/[()\s]/g, (c) => (c === "(" ? "%28" : c === ")" ? "%29" : "%20"))})` : md(label));

const MAX = 3500; // a chat message, not a report

/** Posts one message to a Buzz channel. Never throws; false when off or it didn't go (logged). */
export async function postToBuzz(room: BuzzRoom, message: string): Promise<boolean> {
  const { url, secret } = envOf(room);
  if (!url || !secret || !message.trim()) return false;
  const text = message.length > MAX ? `${message.slice(0, MAX - 1)}…` : message;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, {
      method: "POST", cache: "no-store", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify({ message: text })
    });
    if (!r.ok) { console.error(`buzz ${room}: HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`); return false; }
    return true; // 202: Buzz posts it a moment later
  } catch (e) {
    console.error(`buzz ${room}: ${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
