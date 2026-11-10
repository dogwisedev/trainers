import "server-only";
import { notionApi, notionConfigured, propText, userName, type NotionPage, type NotionProp } from "./notion";
import { long } from "./dates";
import { buzzOn, md, mdLink, postToBuzz } from "./buzz";
import { claim } from "./announce";

// Notion → Buzz, side by side with Sean's Slack automation (#notion-actions), for the whole team: the "Dogwise Buzz" Notion
// integration's webhook (app/api/notion/webhook) tells the app when something is added or changed, and the app posts it.
// What posts: every database the integration is connected to (connect a teamspace's top page and everything under it counts):
//   a new item, or a change to a field worth a ping. Back Office Workstream has its own fields (BACK_OFFICE); any other
//   database pings on changes to its status, select, people, date, checkbox or title fields. Text fields, and typing in a
//   page, stay quiet. A new standalone page (not in a database) posts once, when it's created.
// To quiet a database: Vercel NOTION_QUIET, its names or ids comma-separated (e.g. "Meeting notes, Reading list"), redeploy.
// Notion bundles quick edits into one event; each event posts once (app_state notion_event:<id>).

const BACK_OFFICE = ["9ac45163-21da-4f62-9279-38c155460396", "f3cb7644-9ae1-4a8f-8c67-1df7a7fc5043"]; // data source, database
const BACK_OFFICE_WATCH = ["Status", "Owner", "Next step", "Latest update", "Due", "Priority"];
const WATCH_TYPES = ["status", "select", "multi_select", "people", "date", "checkbox", "title"];
const SHOW_TYPES = ["status", "select", "multi_select", "people", "date", "checkbox", "number", "url", "email", "phone_number", "rich_text"];
const STATUS: Record<string, string> = { "To do": "🔴", "Not started": "🔴", Doing: "🔵", "In progress": "🔵", Blocked: "🟡", "On hold": "⚪", Recurring: "🟣", Done: "✅", Complete: "✅", Completed: "✅", Merged: "🟤" };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const norm = (id?: string | null) => String(id || "").replace(/-/g, "").toLowerCase();
const isBackOffice = (...ids: (string | null | undefined)[]) => ids.some((id) => id && BACK_OFFICE.some((b) => norm(b) === norm(id)));
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s);

const titles = new Map<string, string>();
/** A database's name, from its data source (cached). */
async function boardName(page: NotionPage): Promise<string> {
  if (isBackOffice(page.parent?.data_source_id, page.parent?.database_id)) return "Back Office";
  const ds = page.parent?.data_source_id;
  if (!ds) return "Notion";
  if (titles.has(ds)) return titles.get(ds)!;
  let name = "Notion";
  try { name = ((await notionApi<{ title?: { plain_text?: string }[] }>(`data_sources/${ds}`)).title || []).map((t) => t.plain_text || "").join("").trim() || "Notion"; } catch { /* keep "Notion" */ }
  titles.set(ds, name);
  return name;
}

const quiet = (name: string, page: NotionPage) => {
  const list = (process.env.NOTION_QUIET || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return list.some((q) => q === name.toLowerCase() || q === norm(page.parent?.data_source_id) || q === norm(page.parent?.database_id) || norm(q) === norm(page.parent?.data_source_id) || norm(q) === norm(page.parent?.database_id));
};

export type NotionEvent = {
  id: string; type: string; timestamp?: string;
  authors?: { id: string; type: "person" | "bot" }[];
  entity?: { id: string; type: string };
  data?: { parent?: { id?: string; type?: string; data_source_id?: string }; updated_properties?: string[] };
};

const titleOf = async (page: NotionPage) => { const t = Object.values(page.properties).find((p) => p.type === "title"); return (await propText(t)) || "Untitled"; };

/** Back Office: its own layout (Status, Owner · Due · Priority, Area, Next step, Latest update). */
async function backOfficeLines(page: NotionPage) {
  const get = (name: string) => propText(page.properties[name]);
  const [status, owner, due, priority, area, next, latest] = await Promise.all(["Status", "Owner", "Due", "Priority", "Area", "Next step", "Latest update"].map(get));
  return [
    status ? `Status: ${[STATUS[status], md(status)].filter(Boolean).join(" ")}` : "",
    `Owner: ${owner ? md(owner) : "nobody yet"}${due ? ` · Due: ${isDate(due) ? long(due.slice(0, 10)) : md(due)}` : ""}${priority ? ` · Priority: ${md(priority)}` : ""}`,
    area ? `Area: ${md(area)}` : "",
    next ? `Next step: ${md(clip(next, 200))}` : "",
    latest ? `Latest update: ${md(clip(latest, 280))}` : ""
  ];
}

/** Any other database: up to 6 filled-in fields, status-like ones first. */
async function genericLines(page: NotionPage) {
  const entries = Object.entries(page.properties).filter(([, p]) => SHOW_TYPES.includes(p.type));
  const rank = (p: NotionProp) => ["status", "select", "people", "date"].indexOf(p.type) + 1 || 9;
  entries.sort(([, a], [, b]) => rank(a) - rank(b));
  const out: string[] = [];
  for (const [name, p] of entries) {
    if (out.length >= 6) break;
    let v = await propText(p);
    if (!v || (p.type === "checkbox" && v === "No")) continue;
    if (p.type === "date" && isDate(v)) v = long(v.slice(0, 10));
    const shown = p.type === "status" || p.type === "select" ? [STATUS[v], md(v)].filter(Boolean).join(" ") : md(clip(v, p.type === "rich_text" ? 160 : 120));
    out.push(`${md(name)}: ${shown}`);
  }
  return out;
}

/** The Buzz post for one item. `changed` = names of the fields that changed (empty for a new item). */
export async function notionMessage(page: NotionPage, how: { created: boolean; changed: string[]; by?: string; board?: string }): Promise<string> {
  const board = how.board || (await boardName(page));
  const inDb = !!page.parent?.data_source_id || !!page.parent?.database_id;
  const title = md(await titleOf(page));
  const statusEntry = Object.entries(page.properties).find(([name, p]) => p.type === "status" || (p.type === "select" && /status/i.test(name)));
  const nowDone = /^(done|complete|completed)$/i.test(await propText(statusEntry?.[1]));
  const head = !inDb ? `📄 **New page: ${title}**`
    : how.created ? `🆕 **New in ${md(board)}: ${title}**`
    : nowDone && statusEntry && how.changed.includes(statusEntry[0]) ? `✅ **Done in ${md(board)}: ${title}**`
    : `📋 **${md(board)}: ${title}**`;
  const lines = !inDb ? [] : isBackOffice(page.parent?.data_source_id, page.parent?.database_id) ? await backOfficeLines(page) : await genericLines(page);
  const details = [
    !how.created && how.changed.length ? `Changed: ${how.changed.map(md).join(", ")}` : "",
    ...lines,
    how.by ? `By: ${md(how.by)}` : ""
  ].filter(Boolean).join("\n");
  return [head, details, mdLink("Open in Notion", page.url)].filter(Boolean).join("\n\n");
}

/** One webhook event → at most one post. Returns what happened, for the logs. */
export async function handleNotionEvent(e: NotionEvent): Promise<string> {
  if (e.type !== "page.created" && e.type !== "page.properties_updated") return `ignored ${e.type}`;
  if (!e.entity?.id) return "no page";
  if (!buzzOn("notion")) return "off";
  if (!notionConfigured()) return "NOTION_TOKEN isn't set";
  const page = await notionApi<NotionPage>(`pages/${e.entity.id}`);
  if (page.in_trash || page.archived) return "in trash";
  const inDb = !!page.parent?.data_source_id || !!page.parent?.database_id;
  const created = e.type === "page.created";
  if (!inDb && !created) return "standalone page edit (quiet)";
  const board = inDb ? await boardName(page) : "";
  if (inDb && quiet(board, page)) return `quiet: ${board}`;
  let changed: string[] = [];
  if (!created) {
    const byId = new Map(Object.entries(page.properties).map(([name, p]) => [p.id, name]));
    const names = (e.data?.updated_properties || []).map((id) => byId.get(id) || byId.get(decodeURIComponent(id)) || "").filter(Boolean);
    const backOffice = isBackOffice(page.parent?.data_source_id, page.parent?.database_id);
    changed = names.filter((n) => (backOffice ? BACK_OFFICE_WATCH.includes(n) : WATCH_TYPES.includes(page.properties[n]?.type)));
    if (!changed.length) return "no watched field changed";
  }
  if (!(await claim(`notion_event:${e.id}`))) return "already posted";
  const person = e.authors?.find((a) => a.type === "person");
  const by = person ? await userName(person.id) : "";
  return (await postToBuzz("notion", await notionMessage(page, { created, changed, by, board }))) ? "posted" : "not posted";
}

/** For /api/buzz/test: the last `n` edited database items the integration can see, as Buzz would show them, marked TEST. */
export async function replayRecentNotion(n: number): Promise<{ id: string; message: string }[]> {
  if (!notionConfigured()) throw new Error("NOTION_TOKEN isn't set");
  const res = await notionApi<{ results: NotionPage[] }>("search", {
    method: "POST", body: { page_size: 25, filter: { property: "object", value: "page" }, sort: { timestamp: "last_edited_time", direction: "descending" } }
  });
  const out: { id: string; message: string }[] = [];
  for (const p of (res.results || []).filter((x) => x.parent?.data_source_id || x.parent?.database_id)) {
    if (out.length >= Math.min(Math.max(n, 1), 10)) break;
    const board = await boardName(p);
    const when = new Date(p.last_edited_time).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    out.push({ id: p.id, message: `🧪 **TEST**: a replay of a Notion item edited ${when} ET${quiet(board, p) ? ` (in NOTION_QUIET, so live changes here stay quiet)` : ""}. Nothing to do.\n${await notionMessage(p, { created: false, changed: [], board })}` });
  }
  return out;
}
