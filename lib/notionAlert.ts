import "server-only";
import { notionApi, notionConfigured, propText, userName, type NotionPage } from "./notion";
import { long } from "./dates";
import { buzzOn, md, mdLink, postToBuzz } from "./buzz";
import { claim } from "./announce";

// Notion → Buzz, side by side with Sean's Slack automation (#notion-actions), for the whole team: the "Dogwise Buzz" Notion
// integration's webhook (app/api/notion/webhook) tells the app when an item is added or changed, and the app posts it.
// Only the databases below post, and only for changes worth a ping: a new item, or a change to one of `WATCH`. Typing in a
// page's body, or tidying other fields, stays quiet. Notion bundles quick edits into one event; each event posts once.

type Board = { name: string; room: "notion" };
/** Databases that post, by data source id (and database id: Notion's events can carry either). */
const BOARDS: Record<string, Board> = {
  "9ac45163-21da-4f62-9279-38c155460396": { name: "Back Office", room: "notion" }, // data source
  "f3cb7644-9ae1-4a8f-8c67-1df7a7fc5043": { name: "Back Office", room: "notion" }  // database
};
const WATCH = ["Status", "Owner", "Next step", "Latest update", "Due", "Priority"];
const STATUS: Record<string, string> = { "To do": "🔴", Doing: "🔵", Blocked: "🟡", "On hold": "⚪", Recurring: "🟣", Done: "✅", Merged: "🟤" };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const norm = (id?: string | null) => String(id || "").replace(/-/g, "").toLowerCase();
const boardOf = (...ids: (string | null | undefined)[]) => {
  for (const id of ids) for (const [k, b] of Object.entries(BOARDS)) if (id && norm(id) === norm(k)) return b;
  return null;
};

export type NotionEvent = {
  id: string; type: string; timestamp?: string;
  authors?: { id: string; type: "person" | "bot" }[];
  entity?: { id: string; type: string };
  data?: { parent?: { id?: string; type?: string; data_source_id?: string }; updated_properties?: string[] };
};

/** The Buzz post for one item. `changed` = property names that changed (empty for a new item). */
export async function notionMessage(page: NotionPage, board: Board, how: { created: boolean; changed: string[]; by?: string }): Promise<string> {
  const props = page.properties;
  const get = (name: string) => propText(props[name]);
  const titleProp = Object.entries(props).find(([, p]) => p.type === "title")?.[0];
  const [title, status, owner, due, priority, area, next, latest] = await Promise.all([
    titleProp ? get(titleProp) : Promise.resolve(""), get("Status"), get("Owner"), get("Due"), get("Priority"), get("Area"), get("Next step"), get("Latest update")
  ]);
  const done = status === "Done";
  const head = how.created ? `🆕 **New in ${board.name}: ${md(title || "Untitled")}**`
    : done && how.changed.includes("Status") ? `✅ **Done in ${board.name}: ${md(title || "Untitled")}**`
    : `📋 **${board.name}: ${md(title || "Untitled")}**`;
  const dueText = due ? long(due.slice(0, 10)) : "";
  const details = [
    !how.created && how.changed.length ? `Changed: ${how.changed.map(md).join(", ")}` : "",
    status ? `Status: ${[STATUS[status], md(status)].filter(Boolean).join(" ")}` : "",
    `Owner: ${owner ? md(owner) : "nobody yet"}${dueText ? ` · Due: ${dueText}` : ""}${priority ? ` · Priority: ${md(priority)}` : ""}`,
    area ? `Area: ${md(area)}` : "",
    next ? `Next step: ${md(clip(next, 200))}` : "",
    latest ? `Latest update: ${md(clip(latest, 280))}` : "",
    how.by ? `By: ${md(how.by)}` : ""
  ].filter(Boolean).join("\n");
  return [head, details, mdLink("Open in Notion", page.url)].join("\n\n");
}

/** One webhook event → at most one post. Returns what happened, for the logs. */
export async function handleNotionEvent(e: NotionEvent): Promise<string> {
  if (e.type !== "page.created" && e.type !== "page.properties_updated") return `ignored ${e.type}`;
  if (!e.entity?.id) return "no page";
  const parent = e.data?.parent;
  let board = boardOf(parent?.data_source_id, parent?.id);
  if (!buzzOn("notion")) return "off";
  if (!notionConfigured()) return "NOTION_TOKEN isn't set";
  const page = await notionApi<NotionPage>(`pages/${e.entity.id}`);
  board = board || boardOf(page.parent?.data_source_id, page.parent?.database_id);
  if (!board) return "not a board that posts";
  if (page.in_trash || page.archived) return "in trash";
  const created = e.type === "page.created";
  // Property ids → names, keeping only the ones worth a post
  const byId = new Map(Object.entries(page.properties).map(([name, p]) => [p.id, name]));
  const changed = created ? [] : (e.data?.updated_properties || []).map((id) => byId.get(id) || byId.get(decodeURIComponent(id)) || "").filter((n) => WATCH.includes(n));
  if (!created && !changed.length) return "no watched field changed";
  if (!(await claim(`notion_event:${e.id}`))) return "already posted";
  const person = e.authors?.find((a) => a.type === "person");
  const by = person ? await userName(person.id) : "";
  return (await postToBuzz(board.room, await notionMessage(page, board, { created, changed, by }))) ? "posted" : "not posted";
}

/** For /api/buzz/test: the last `n` edited Back Office items, as a change post would show them, marked TEST. Posts nothing. */
export async function replayRecentNotion(n: number): Promise<{ id: string; message: string }[]> {
  if (!notionConfigured()) throw new Error("NOTION_TOKEN isn't set");
  const [dsId, board] = Object.entries(BOARDS)[0];
  const res = await notionApi<{ results: NotionPage[] }>(`data_sources/${dsId}/query`, {
    method: "POST", body: { page_size: Math.min(Math.max(n, 1), 10), sorts: [{ timestamp: "last_edited_time", direction: "descending" }] }
  });
  const out: { id: string; message: string }[] = [];
  for (const p of res.results || []) {
    const when = new Date(p.last_edited_time).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    out.push({ id: p.id, message: `🧪 **TEST**: a replay of a Notion item edited ${when} ET. Nothing to do.\n${await notionMessage(p, board, { created: false, changed: [] })}` });
  }
  return out;
}
