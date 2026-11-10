import "server-only";

// Notion's API, read-only, as the "Dogwise Buzz" integration (Vercel variable NOTION_TOKEN, the integration's secret).
// The integration only sees the pages and databases it has been added to (⋯ → Connections in Notion).
const VERSION = "2025-09-03";
export const notionConfigured = () => !!process.env.NOTION_TOKEN;

export async function notionApi<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(`https://api.notion.com/v1/${path}`, {
    method: init?.method || "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, "Notion-Version": VERSION, "Content-Type": "application/json" },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {})
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Notion ${r.status}: ${(d as { message?: string }).message || r.statusText}`);
  return d as T;
}

export type NotionProp = { id: string; type: string; [k: string]: unknown };
export type NotionPage = { id: string; url: string; created_time: string; last_edited_time: string; in_trash?: boolean; archived?: boolean;
  parent: { type: string; data_source_id?: string; database_id?: string }; properties: Record<string, NotionProp> };

type Rich = { plain_text?: string }[];
type Person = { id: string; name?: string | null };

const names = new Map<string, string>();
/** A person's name (cached); needs the integration's "Read user information" capability, else "". */
export async function userName(id: string): Promise<string> {
  if (names.has(id)) return names.get(id)!;
  let n = "";
  try { n = (await notionApi<{ name?: string | null }>(`users/${id}`)).name || ""; } catch { /* no capability, or a bot */ }
  names.set(id, n);
  return n;
}

/** A property as plain text: titles, text, selects, statuses, people, dates, numbers, checkboxes, URLs. */
export async function propText(p: NotionProp | undefined): Promise<string> {
  if (!p) return "";
  const v = p[p.type] as unknown;
  switch (p.type) {
    case "title": case "rich_text": return ((v as Rich) || []).map((t) => t.plain_text || "").join("").trim();
    case "select": case "status": return (v as { name?: string } | null)?.name || "";
    case "multi_select": return ((v as { name: string }[]) || []).map((o) => o.name).join(", ");
    case "people": {
      const people = (v as Person[]) || [];
      return (await Promise.all(people.map(async (u) => u.name || (await userName(u.id))))).filter(Boolean).join(", ");
    }
    case "date": { const d = v as { start?: string; end?: string | null } | null; return d?.start ? (d.end ? `${d.start} → ${d.end}` : d.start) : ""; }
    case "number": return v == null ? "" : String(v);
    case "checkbox": return v ? "Yes" : "No";
    case "url": case "email": case "phone_number": return (v as string) || "";
    default: return "";
  }
}
