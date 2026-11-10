import "server-only";

// Buzz, side by side with Slack. Each Buzz channel has a workflow with a Webhook trigger and one "Send message" step whose
// text is exactly {{trigger.message}}. The app POSTs {"message": "..."} to the workflow's /hooks URL with the secret in a header.
// No keys, no accounts. Off until both variables of a room are set; a Buzz problem never stops or slows anything else.
// Vercel variables (each pair from the workflow's webhook dialog; the secret is shown once):
//   BUZZ_OFFICE_URL, BUZZ_OFFICE_SECRET       the app's admin alerts (the same ones that go to admins' phones)
//   BUZZ_PAYMENTS_URL, BUZZ_PAYMENTS_SECRET   Stripe payments, paid and failed
//   BUZZ_SALES_URL, BUZZ_SALES_SECRET         each new Closed Won deal (lib/salesWin.ts)
//   BUZZ_LEADS_URL, BUZZ_LEADS_SECRET         each new Bark lead (lib/leadAlert.ts)
//   BUZZ_NOTION_URL, BUZZ_NOTION_SECRET       Notion changes (lib/notionAlert.ts)
//   (the Slack mirror has a hook per channel: BUZZ_MIRROR_HOOKS, read by lib/slackMirror.ts, posted with postToHook)
export type BuzzRoom = "office" | "payments" | "sales" | "leads" | "notion";

// Pasted values often carry quotes, spaces or a line break; none belong in a URL or a secret, so they're dropped
const clean = (v: string | undefined) => (v || "").replace(/\s+/g, "").replace(/^["']+|["']+$/g, "");
const envOf = (room: BuzzRoom) => {
  const key = room.toUpperCase();
  return { url: clean(process.env[`BUZZ_${key}_URL`]), secret: clean(process.env[`BUZZ_${key}_SECRET`]) };
};

/** For the test page: which hook the app is using, without showing the secret. The tag is the first 6 characters of the
 *  secret's SHA-256, so it can be compared with the secret you hold (see the README) but not turned back into it. */
export async function buzzFingerprint(room: BuzzRoom): Promise<string> {
  const { url, secret } = envOf(room);
  return hookFingerprint(url, secret);
}

/** The same for any hook. */
export async function hookFingerprint(urlIn: string, secretIn: string): Promise<string> {
  const url = clean(urlIn), secret = clean(secretIn);
  if (!url || !secret) return "not set";
  const { createHash } = await import("crypto");
  let where = url;
  try { const u = new URL(url); where = `${u.host} …${u.pathname.slice(-6)}`; } catch { return `URL isn't a web address (starts "${url.slice(0, 12)}…")`; }
  const warn = /\/hooks\/[0-9a-f-]{36}$/i.test(url) ? "" : " · ⚠ URL doesn't end in /hooks/<workflow id>";
  return `hook ${where} · secret ${secret.length} characters, tag ${createHash("sha256").update(secret).digest("hex").slice(0, 6)}${warn}`;
}
export const buzzOn = (room: BuzzRoom) => { const e = envOf(room); return !!(e.url && e.secret); };

/** Markdown-safe text for names, notes and anything a person typed (Buzz renders messages as Markdown). */
export const md = (s: unknown) => String(s ?? "").replace(/[\\`*_[\]<>|~#]/g, (c) => `\\${c}`).replace(/\s+/g, " ").trim();
/** A Markdown link; the label is escaped, the URL must be absolute https (anything else is shown as plain text). */
export const mdLink = (label: string, url: string | null | undefined) => (url && /^https:\/\//.test(url) ? `[${md(label)}](${url.replace(/[()\s]/g, (c) => (c === "(" ? "%28" : c === ")" ? "%29" : "%20"))})` : md(label));

const MAX = 3500; // a chat message, not a report

/** Posts one message to a Buzz channel. Never throws; false when off or it didn't go (logged). */
export async function postToBuzz(room: BuzzRoom, message: string, extra?: Record<string, string>): Promise<boolean> {
  return (await postToBuzzDetailed(room, message, extra)).ok;
}

/** The same, saying what happened ("sent", "off: …", "HTTP 404 …", "timed out"), for the test page. */
export async function postToBuzzDetailed(room: BuzzRoom, message: string, extra?: Record<string, string>): Promise<{ ok: boolean; result: string; status?: number }> {
  const { url, secret } = envOf(room);
  const key = room.toUpperCase();
  if (!url || !secret) return { ok: false, result: `off: BUZZ_${key}_URL and BUZZ_${key}_SECRET must both be set (then redeploy)` };
  return postToHook(url, secret, message, extra, room);
}

/** Posts to one workflow's hook (a Buzz workflow can only post in its own channel, so each channel has its own hook). */
export async function postToHook(urlIn: string, secretIn: string, message: string, extra?: Record<string, string>, label = "hook"): Promise<{ ok: boolean; result: string; status?: number }> {
  const url = clean(urlIn), secret = clean(secretIn), room = label;
  if (!url || !secret) return { ok: false, result: "no hook set" };
  if (!message.trim()) return { ok: false, result: "nothing to send" };
  const text = message.length > MAX ? `${message.slice(0, MAX - 1)}…` : message;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, {
      method: "POST", cache: "no-store", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify({ ...(extra || {}), message: text })
    });
    if (!r.ok) {
      const body = (await r.text().catch(() => "")).slice(0, 200);
      console.error(`buzz ${room}: HTTP ${r.status} ${body}`);
      return { ok: false, result: `HTTP ${r.status} ${body}`.trim(), status: r.status };
    }
    return { ok: true, result: "sent" }; // 202: Buzz posts it a moment later
  } catch (e) {
    const why = (e as Error).name === "AbortError" ? "timed out" : (e as Error).message;
    console.error(`buzz ${room}: ${why}`);
    return { ok: false, result: why };
  } finally {
    clearTimeout(timer);
  }
}
