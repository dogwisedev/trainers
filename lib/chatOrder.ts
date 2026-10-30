// Chat list order (admin and trainer lists). Pure functions, so they're easy to test.
//  1. In care now: a dog on the deal is with the trainer today. Ending soonest first.
//  2. Coming up: the next dog starts later. Starting soonest first.
//  3. Finished: most recently finished first.
//  4. No booking found: newest message first.
// A deal with several dogs is one chat; it counts as "in care" if any of its dogs is.
import type { ChatRow } from "./chatTypes";
import { short } from "./dates";

export type Span = { start_date: string; end_date: string; status: string };
export type ChatGroup = "now" | "soon" | "done" | "none";
export type Placed = { chat: ChatRow; group: ChatGroup; start: string | null; end: string | null };
export const GROUP_LABEL: Record<ChatGroup, string> = { now: "In care now", soon: "Coming up", done: "Finished", none: "No booking found" };
const ORDER: ChatGroup[] = ["now", "soon", "done", "none"];

export function placeChat(chat: ChatRow, spans: Span[], today: string): Placed {
  const live = spans.filter((b) => b.status !== "cancelled");
  if (!live.length) return { chat, group: "none", start: null, end: null };
  const inCare = live.filter((b) => b.start_date <= today && today <= b.end_date);
  if (inCare.length) return { chat, group: "now", start: min(inCare.map((b) => b.start_date)), end: max(inCare.map((b) => b.end_date)) };
  const next = live.filter((b) => b.start_date > today);
  if (next.length) return { chat, group: "soon", start: min(next.map((b) => b.start_date)), end: max(next.map((b) => b.end_date)) };
  return { chat, group: "done", start: min(live.map((b) => b.start_date)), end: max(live.map((b) => b.end_date)) };
}

/**
 * Groups stay as they are (In care now, Starting soon, …). Inside each group:
 *  "latest": newest message first (the admin list's default)  ·  "dates": soonest drop-off / start first (the trainer list, or "By dates")
 */
export function orderChats(chats: ChatRow[], spansByKey: Map<string, Span[]>, today: string, by: "latest" | "dates" = "dates"): Placed[] {
  const placed = chats.map((c) => placeChat(c, spansByKey.get(c.deal_key) || [], today));
  const last = (p: Placed) => p.chat.last_message_at || p.chat.created_at || "";
  return placed.sort((a, b) => {
    if (a.group !== b.group) return ORDER.indexOf(a.group) - ORDER.indexOf(b.group);
    if (by === "latest") return last(b).localeCompare(last(a));
    const byDate = a.group === "now" ? cmp(a.end, b.end) : a.group === "soon" ? cmp(a.start, b.start) : a.group === "done" ? cmp(b.end, a.end) : 0;
    return byDate || last(b).localeCompare(last(a));
  });
}

/** The same list, split into its groups (empty groups left out). */
export function groupChats(placed: Placed[]): { group: ChatGroup; label: string; items: Placed[] }[] {
  return ORDER.map((g) => ({ group: g, label: GROUP_LABEL[g], items: placed.filter((p) => p.group === g) })).filter((x) => x.items.length);
}

/** "In care until Nov 2", "Starts Oct 20", "Finished Sep 30" */
export const datesLabel = (p: Placed) =>
  p.group === "now" ? `In care until ${short(p.end!)}` : p.group === "soon" ? `Starts ${short(p.start!)}` : p.group === "done" ? `Finished ${short(p.end!)}` : undefined;

/** Does a chat's name match the search? (dog, client, trainer, client email) */
export const nameMatches = (c: ChatRow, q: string) =>
  [c.title, c.client_name, c.trainer_name, c.client_email].some((v) => (v || "").toLowerCase().includes(q.toLowerCase()));

const min = (xs: string[]) => xs.reduce((m, x) => (x < m ? x : m));
const max = (xs: string[]) => xs.reduce((m, x) => (x > m ? x : m));
const cmp = (a: string | null, b: string | null) => (a || "").localeCompare(b || "");

/** "Needs a reply" first: unread chats, newest message on top. Then the usual groups for everything else. */
export function groupWithUnread(placed: Placed[], isUnread: (c: ChatRow) => boolean): { group: string; label: string; items: Placed[] }[] {
  const last = (p: Placed) => p.chat.last_message_at || p.chat.created_at || "";
  const unread = placed.filter((p) => isUnread(p.chat)).sort((a, b) => last(b).localeCompare(last(a)));
  const rest = placed.filter((p) => !isUnread(p.chat));
  return [...(unread.length ? [{ group: "unread", label: "Needs a reply", items: unread }] : []), ...groupChats(rest)];
}
