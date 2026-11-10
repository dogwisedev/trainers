import "server-only";
import { serviceClient } from "./supabase";
import { md, postToHook } from "./buzz";
import { claim, claimed } from "./announce";

// Slack → Buzz mirror, for the move: the "Buzz Mirror" Slack app sends every new message in the channels below to
// /api/slack/mirror, and the app posts it to the matching Buzz channel within seconds; /api/slack/mirror/backfill posts
// last month's history, one message per day. People's messages only: bots (HubSpot, payments, the mirror itself) stay out.
// A Buzz workflow can only post in its own channel, so each mirrored channel has its own webhook workflow (Webhook trigger,
// one Send message step whose text is {{trigger.message}}), and Vercel BUZZ_MIRROR_HOOKS lists them, one per line:
//   general https://dogwise-academy.communities.buzz.xyz/hooks/<workflow id> <secret>
// (";" between entries works too, and "name=url|secret"). Also SLACK_MIRROR_TOKEN (the Slack app's Bot User OAuth Token)
// and SLACK_MIRROR_SIGNING_SECRET. Stop it on switch day with SLACK_MIRROR_OFF=1 (or uninstall the Slack app).
// Adding a channel: one line here, invite @Buzz Mirror in Slack, a workflow in the Buzz channel, a line in BUZZ_MIRROR_HOOKS.
export const MIRROR: { slack: string; name: string }[] = [
  { slack: "C048YKVJZFA", name: "back-office-staff" },
  { slack: "C0C62V15BB3", name: "first-word-dump" },
  { slack: "C0AG9FQNLAU", name: "flagged-ongoing" },
  { slack: "C03L08NG4CS", name: "general" },
  { slack: "C0CB599QQH2", name: "ops_app" },
  { slack: "C03LQ1EGE6L", name: "random" },
  { slack: "C03KTLHS5DL", name: "sales" },
  { slack: "C05AHA58W65", name: "sales-team" },
  { slack: "C0BG5HFHZMZ", name: "sales-team-private" },
  { slack: "C08CC35BPEK", name: "trainer-information" },
  { slack: "C043YQ60R50", name: "trainers" }
];
const bySlack = new Map(MIRROR.map((m) => [m.slack, m]));
export const mirrorOn = () => !!process.env.SLACK_MIRROR_TOKEN && process.env.SLACK_MIRROR_OFF !== "1";

/** Each channel's hook, from BUZZ_MIRROR_HOOKS. */
export function mirrorHooks(): Map<string, { url: string; secret: string }> {
  const out = new Map<string, { url: string; secret: string }>();
  for (const line of (process.env.BUZZ_MIRROR_HOOKS || "").split(/[\n;]+/)) {
    const m = line.replace(/["']/g, "").trim().match(/^#?([A-Za-z0-9_-]+)\s*[=:\s]\s*(https:\/\/\S+?)\s*[|\s]\s*(\S+)$/);
    if (m) out.set(m[1].toLowerCase(), { url: m[2], secret: m[3] });
  }
  return out;
}
/** Post into one mirrored channel's Buzz workflow. */
export async function postToMirror(name: string, message: string) {
  const h = mirrorHooks().get(name.toLowerCase());
  if (!h) return { ok: false, result: `no hook for #${name} in BUZZ_MIRROR_HOOKS`, status: undefined as number | undefined };
  return postToHook(h.url, h.secret, message, undefined, `mirror #${name}`);
}

// ---------- Slack API (read-only) ----------
export type SlackMsg = { ts: string; user?: string; bot_id?: string; subtype?: string; text?: string; thread_ts?: string; reply_count?: number;
  files?: { name?: string; title?: string; permalink?: string }[] };

async function slack<T>(method: string, params: Record<string, string>): Promise<T> {
  const r = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { cache: "no-store", headers: { Authorization: `Bearer ${process.env.SLACK_MIRROR_TOKEN}` } });
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!d.ok) throw new Error(`Slack ${method}: ${d.error || r.status}`);
  return d as T;
}

const names = new Map<string, string>();
async function userName(id: string): Promise<string> {
  if (names.has(id)) return names.get(id)!;
  let n = "Someone";
  try {
    const u = (await slack<{ user: { real_name?: string; profile?: { display_name?: string; real_name?: string } } }>("users.info", { user: id })).user;
    n = u.profile?.display_name || u.profile?.real_name || u.real_name || "Someone";
  } catch { /* keep "Someone" */ }
  names.set(id, n);
  return n;
}

/** People's messages only: skip bots, joins, edits, deletions and other system notices. */
export const isPerson = (m: SlackMsg) => !!m.user && !m.bot_id && (!m.subtype || ["thread_broadcast", "file_share", "me_message"].includes(m.subtype));

const EMOJI: Record<string, string> = { tada: "🎉", "+1": "👍", thumbsup: "👍", "-1": "👎", heart: "❤️", joy: "😂", smile: "😄", grinning: "😀", laughing: "😆",
  sweat_smile: "😅", slightly_smiling_face: "🙂", blush: "😊", wink: "😉", pray: "🙏", white_check_mark: "✅", heavy_check_mark: "✔️", x: "❌", fire: "🔥",
  eyes: "👀", raised_hands: "🙌", clap: "👏", ok_hand: "👌", muscle: "💪", wave: "👋", dog: "🐶", dog2: "🐕", "100": "💯", rocket: "🚀", warning: "⚠️",
  star: "⭐", exclamation: "❗", question: "❓", sob: "😭", thinking_face: "🤔", partying_face: "🥳", point_up: "☝️", point_right: "👉", rotating_light: "🚨" };
/** Slack's markup → Buzz Markdown: people, channels, links, bold, strike-through and common emoji. */
export async function slackToMarkdown(text: string): Promise<string> {
  let s = text || "";
  const ids = [...new Set([...s.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]))];
  const who = new Map(await Promise.all(ids.map(async (id) => [id, await userName(id)] as [string, string])));
  s = s.replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id) => `@${who.get(id) || "someone"}`)
    .replace(/<#C[A-Z0-9]+\|([^>]*)>/g, "#$1").replace(/<#C[A-Z0-9]+>/g, "#channel")
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, "@$1").replace(/<!subteam\^[A-Z0-9]+\|([^>]*)>/g, "$1").replace(/<!date\^[^|>]*\|([^>]*)>/g, "$1")
    .replace(/<mailto:[^|>]+\|([^>]*)>/g, "$1").replace(/<(https?:\/\/[^|>]+)\|([^>]*)>/g, "[$2]($1)").replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/(^|[\s(>])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1**$2**").replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:;]|$)/g, "$1~~$2~~")
    .replace(/:([a-z0-9_+-]+):(?::skin-tone-\d:)?/g, (all, n) => EMOJI[n] || all)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return s.trim();
}

const clock = (ts: string) => new Date(Number(ts) * 1000).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const etDate = (ts: string) => new Date(Number(ts) * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const filesText = (m: SlackMsg) => (m.files || []).map((f) => `📎 ${f.permalink ? `[${md(f.title || f.name || "file")}](${f.permalink})` : md(f.title || f.name || "file")}`).join("\n");
const firstLine = (s: string, n = 60) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Per channel, when its live mirror took over: the first message it actually got into Buzz (or the first backfill, if
 *  that came first). History before it comes from the backfill, so messages the live mirror couldn't post (before the
 *  hook was set, say) are never lost. */
async function liveSince(slackId: string): Promise<number | null> {
  const { data } = await serviceClient().from("app_state").select("value").eq("key", `slack_mirror_since:${slackId}`).maybeSingle();
  return data?.value ? Number(data.value) : null;
}
async function markLive(slackId: string, ts: number) {
  await serviceClient().from("app_state").insert({ key: `slack_mirror_since:${slackId}`, value: String(ts) }); // the first one stays
}

// ---------- live ----------
type SlackEventBody = { type: string; event_id?: string; event?: SlackMsg & { type: string; channel: string } };

/** One Slack event → at most one Buzz post. */
export async function mirrorEvent(body: SlackEventBody): Promise<string> {
  const e = body.event;
  if (body.type !== "event_callback" || !e || e.type !== "message") return "ignored";
  if (!mirrorOn()) return "off";
  const m = bySlack.get(e.channel);
  if (!m) return "not a mirrored channel";
  if (!isPerson(e)) return "not a person's message";
  const key = `slack_event:${body.event_id || `${e.channel}:${e.ts}`}`;
  if (!(await claim(key))) return "already mirrored";
  const name = md(await userName(e.user!));
  const text = await slackToMarkdown(e.text || "");
  let head = `**${name}** · ${clock(e.ts)}`;
  if (e.thread_ts && e.thread_ts !== e.ts) {
    let to = "";
    try {
      const parent = (await slack<{ messages: SlackMsg[] }>("conversations.replies", { channel: e.channel, ts: e.thread_ts, limit: "1" })).messages?.[0];
      if (parent) to = ` · reply to ${md(parent.user ? await userName(parent.user) : "a message")}: “${md(firstLine(await slackToMarkdown(parent.text || "")))}”`;
    } catch { /* the reply still goes, without the quote */ }
    head = `↳ ${head}${to || " · reply in a thread"}`;
  }
  const r = await postToMirror(m.name, [head, text, filesText(e)].filter(Boolean).join("\n"));
  if (!r.ok) { await serviceClient().from("app_state").delete().eq("key", key); return `not posted: ${r.result} (the backfill will bring it)`; }
  if ((await liveSince(m.slack)) == null) await markLive(m.slack, Number(e.ts));
  return "posted";
}

// ---------- backfill ----------
/** Last `days` days of one channel, one Buzz post per day (split if long), oldest first, up to when the mirror started.
 *  Each day part is claimed once, so running it again only posts what's missing. Stops before `budgetMs` to stay in time. */
export async function backfillChannel(name: string, days: number, budgetMs = 45000): Promise<{ posted: number; skipped: number; done: boolean; note: string }> {
  const start = Date.now();
  const m = MIRROR.find((x) => x.name === name);
  if (!m) return { posted: 0, skipped: 0, done: true, note: `no mirrored channel called ${name}` };
  if (!mirrorOn()) return { posted: 0, skipped: 0, done: true, note: "the mirror is off (SLACK_MIRROR_TOKEN unset, or SLACK_MIRROR_OFF=1)" };
  if (!mirrorHooks().has(m.name)) return { posted: 0, skipped: 0, done: true, note: `no hook for #${m.name} in BUZZ_MIRROR_HOOKS yet` };
  // Up to when this channel's live mirror took over; if it hasn't yet, up to now, and the live mirror carries on from here
  let until = await liveSince(m.slack);
  if (until == null) { until = Date.now() / 1000; await markLive(m.slack, until); until = (await liveSince(m.slack)) ?? until; }
  const oldest = String(until - Math.min(Math.max(days, 1), 60) * 86400);

  // The channel's messages, then each thread's replies under its parent
  const top: SlackMsg[] = [];
  let cursor = "";
  for (let i = 0; i < 30; i++) {
    const r = await slack<{ messages: SlackMsg[]; has_more?: boolean; response_metadata?: { next_cursor?: string } }>("conversations.history",
      { channel: m.slack, oldest, latest: String(until), limit: "200", ...(cursor ? { cursor } : {}) });
    top.push(...(r.messages || []));
    cursor = r.response_metadata?.next_cursor || "";
    if (!r.has_more || !cursor) break;
  }
  const replies = new Map<string, SlackMsg[]>();
  for (const p of top.filter((x) => (x.reply_count || 0) > 0)) {
    try { replies.set(p.ts, ((await slack<{ messages: SlackMsg[] }>("conversations.replies", { channel: m.slack, ts: p.ts, limit: "200" })).messages || []).filter((x) => x.ts !== p.ts && x.subtype !== "thread_broadcast" && Number(x.ts) < until)); } // broadcasts are in the channel already
    catch { /* the parent still comes across */ }
  }

  // Day by day (Eastern), as lines
  const byDay = new Map<string, string[]>();
  for (const msg of top.filter(isPerson).sort((a, b) => Number(a.ts) - Number(b.ts))) {
    const lines = [`**${clock(msg.ts)} · ${md(await userName(msg.user!))}:** ${await slackToMarkdown(msg.text || "")}`, filesText(msg)].filter(Boolean);
    for (const r of (replies.get(msg.ts) || []).filter(isPerson)) lines.push(`  ↳ **${clock(r.ts)} · ${md(await userName(r.user!))}:** ${await slackToMarkdown(r.text || "")}`, ...(filesText(r) ? [filesText(r)] : []));
    const d = etDate(msg.ts);
    byDay.set(d, [...(byDay.get(d) || []), ...lines]);
  }

  // Posts of at most ~3,300 characters each
  const posts: { key: string; text: string }[] = [];
  for (const [d, lines] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const parts: string[][] = [[]];
    let size = 0;
    for (const l of lines) {
      if (size + l.length > 3300 && parts[parts.length - 1].length) { parts.push([]); size = 0; }
      parts[parts.length - 1].push(l.length > 3300 ? `${l.slice(0, 3299)}…` : l);
      size += l.length + 1;
    }
    parts.forEach((p, i) => posts.push({ key: `slack_day:${m.slack}:${d}:${i + 1}`,
      text: [`📜 **From Slack · ${dayLabel(d)}** · #${md(m.name)}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ""}`, p.join("\n")].join("\n\n") }));
  }
  const done = await claimed(posts.map((p) => p.key));
  let posted = 0;
  const todo = posts.filter((p) => !done.has(p.key));
  for (const p of todo) {
    if (Date.now() - start > budgetMs) return { posted, skipped: done.size, done: false, note: "out of time for this run: open it again to carry on" };
    if (!(await claim(p.key))) continue;
    const r = await postToMirror(m.name, p.text);
    if (!r.ok) {
      await serviceClient().from("app_state").delete().eq("key", p.key);
      return { posted, skipped: done.size, done: false, note: r.status === 429 ? "Buzz asked to slow down: open it again in a minute" : `Buzz didn't take it: ${r.result}` };
    }
    posted++;
    await new Promise((res) => setTimeout(res, 600)); // in order, gently
  }
  return { posted, skipped: done.size, done: true, note: posts.length ? "all of it is in Buzz" : "no messages from people in that time" };
}

/** For the test page: how far each channel's backfill has got, and since when its live mirror has been posting. */
export async function backfillStatus(): Promise<{ name: string; days: number; liveSince: number | null }[]> {
  const sb = serviceClient();
  const [{ data }, { data: live }] = await Promise.all([
    sb.from("app_state").select("key").like("key", "slack_day:%"),
    sb.from("app_state").select("key, value").like("key", "slack_mirror_since:%")
  ]);
  const count = new Map<string, Set<string>>();
  for (const r of (data || []) as { key: string }[]) {
    const [, ch, d] = r.key.split(":");
    count.set(ch, (count.get(ch) || new Set()).add(d));
  }
  const since = new Map(((live || []) as { key: string; value: string }[]).map((r) => [r.key.split(":")[1], Number(r.value)]));
  return MIRROR.map((m) => ({ name: m.name, days: count.get(m.slack)?.size || 0, liveSince: since.get(m.slack) ?? null }));
}
