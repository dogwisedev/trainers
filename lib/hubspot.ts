import "server-only";

// HubSpot, read-only: deal dates and whether the deal is still Closed Won.
// Vercel variables:
//   HUBSPOT_TOKEN        private app token (scope crm.objects.deals.read)
//   HUBSPOT_SYNC         dry (default: writes nothing, shows what it would do) | quiet (writes dates, no emails or change incidents) | live
//   HUBSPOT_START_PROP   optional, internal name of the start date (found automatically: program_start_date / "Program Start Date")
//   HUBSPOT_END_PROP     optional, internal name of the end date (found automatically: program_end_date / "Program End Date"; none = keep each booking's length)
const BASE = "https://api.hubapi.com";

export const hubspotConfigured = () => !!process.env.HUBSPOT_TOKEN;
export type SyncMode = "dry" | "quiet" | "live";
export const syncMode = (): SyncMode => {
  const m = (process.env.HUBSPOT_SYNC || "").trim().toLowerCase();
  return m === "live" || m === "quiet" ? m : "dry";
};
/** Booking dates come from HubSpot (so they're locked in the app) once the sync is writing. */
export const datesFromHubspot = () => hubspotConfigured() && syncMode() !== "dry";

async function hs<T>(path: string, init: RequestInit = {}, tries = 3): Promise<T> {
  const r = await fetch(BASE + path, {
    ...init, cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) }
  });
  if (r.status === 429 && tries > 1) { // rate limited: wait and try again
    await new Promise((ok) => setTimeout(ok, (Number(r.headers.get("retry-after")) || 1) * 1000));
    return hs<T>(path, init, tries - 1);
  }
  if (!r.ok && r.status !== 207) throw new Error(`HubSpot ${r.status} on ${path.split("?")[0]}: ${(await r.text()).slice(0, 300)}`);
  return r.json() as Promise<T>;
}

type Prop = { name: string; label: string; type: string };
export type DateProps = { start: Prop; end: Prop | null };
let cachedProps: DateProps | null = null;

/** Finds the deal's start and end date properties (by env name, internal name, then label). */
export async function dealDateProps(): Promise<DateProps> {
  if (cachedProps) return cachedProps;
  const { results } = await hs<{ results: Prop[] }>("/crm/v3/properties/deals?archived=false");
  const pick = (envName: string | undefined, name: string, label: RegExp) => {
    if (envName) return results.find((p) => p.name === envName.trim()) || null;
    return results.find((p) => p.name === name) || results.find((p) => label.test(p.label.trim())) || null;
  };
  const start = pick(process.env.HUBSPOT_START_PROP, "program_start_date", /^program start date$/i);
  if (!start) throw new Error(`Couldn't find the deal's start date property${process.env.HUBSPOT_START_PROP ? ` "${process.env.HUBSPOT_START_PROP}"` : " (program_start_date)"}. Set HUBSPOT_START_PROP in Vercel.`);
  const end = pick(process.env.HUBSPOT_END_PROP, "program_end_date", /^program end date$/i);
  if (process.env.HUBSPOT_END_PROP && !end) throw new Error(`Couldn't find the deal property "${process.env.HUBSPOT_END_PROP}" (HUBSPOT_END_PROP).`);
  cachedProps = { start, end };
  return cachedProps;
}

export type DealProps = Record<string, string | null>;
/** Reads deals in batches of 100. Deals HubSpot can't find (deleted, merged) are simply missing from the map. */
export async function readDeals(ids: string[], properties: string[]): Promise<Map<string, DealProps>> {
  const out = new Map<string, DealProps>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 100) {
    const res = await hs<{ results?: { id: string; properties: DealProps }[] }>("/crm/v3/objects/deals/batch/read", {
      method: "POST", body: JSON.stringify({ inputs: uniq.slice(i, i + 100).map((id) => ({ id })), properties })
    });
    for (const d of res.results || []) out.set(String(d.id), d.properties || {});
  }
  return out;
}

let stageLabels: Map<string, string> | null = null;
/** "Cancelled/Refunded", "Closed Lost"… for a stage id. */
export async function stageLabel(id: string | null | undefined): Promise<string> {
  if (!id) return "unknown stage";
  try {
    if (!stageLabels) {
      const { results } = await hs<{ results: { label: string; stages: { id: string; label: string }[] }[] }>("/crm/v3/pipelines/deals");
      stageLabels = new Map(results.flatMap((p) => p.stages.map((s) => [s.id, s.label] as [string, string])));
    }
    return stageLabels.get(id) || id;
  } catch { return id; }
}

/** A HubSpot date value as YYYY-MM-DD. Date properties are midnight UTC, so the UTC date is the calendar date. */
export function hsDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  if (/^\d{10,}$/.test(t)) return new Date(Number(t)).toISOString().slice(0, 10);
  return null;
}
