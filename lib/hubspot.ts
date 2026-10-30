import "server-only";
import { addDays } from "./dates";

// HubSpot, read-only: deal dates and whether the deal is still Closed Won.
// Vercel variables:
//   HUBSPOT_TOKEN        private app token (scope crm.objects.deals.read)
//   HUBSPOT_SYNC         dry (default: writes nothing, shows what it would do) | quiet (writes dates, no emails or change incidents) | live
//   HUBSPOT_START_PROP   optional, internal name of the start date (found automatically: program_start_date / "Program Start Date")
//   HUBSPOT_END_PROP     optional, internal name of the end date (found automatically: training_end_date / "Training End Date", or program_end_date; none = keep each booking's length)
const BASE = "https://api.hubapi.com";

export const hubspotConfigured = () => !!process.env.HUBSPOT_TOKEN;
export type SyncMode = "dry" | "quiet" | "live";
export const syncMode = (): SyncMode => {
  const m = (process.env.HUBSPOT_SYNC || "").trim().toLowerCase();
  return m === "live" || m === "quiet" ? m : "dry";
};
/** Booking dates come from HubSpot (so they're locked in the app) once the sync is writing. */
export const datesFromHubspot = () => hubspotConfigured() && syncMode() !== "dry";

// HubSpot allows 4 search requests a second. Searches queue here, at most 3 a second, so a burst (Pulse's snapshot) never trips it.
let searchQueue: Promise<void> = Promise.resolve(), lastSearchAt = 0;
function searchSlot(): Promise<void> {
  const mine = searchQueue.then(async () => { const wait = lastSearchAt + 340 - Date.now(); if (wait > 0) await new Promise((ok) => setTimeout(ok, wait)); lastSearchAt = Date.now(); });
  searchQueue = mine.catch(() => {});
  return mine;
}

async function hs<T>(path: string, init: RequestInit = {}, tries = 4): Promise<T> {
  if (path.includes("/search")) await searchSlot();
  const r = await fetch(BASE + path, {
    ...init, cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) }
  });
  if (r.status === 429 && tries > 1) { // rate limited: wait and try again (a secondly limit clears in about a second)
    await new Promise((ok) => setTimeout(ok, Math.max(1100, (Number(r.headers.get("retry-after")) || 1) * 1000)));
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
  const pick = (envName: string | undefined, names: string[], label: RegExp) => {
    if (envName) return results.find((p) => p.name === envName.trim()) || null;
    for (const n of names) { const hit = results.find((p) => p.name === n); if (hit) return hit; }
    return results.find((p) => label.test(p.label.trim())) || null;
  };
  const start = pick(process.env.HUBSPOT_START_PROP, ["program_start_date"], /^program start date$/i);
  if (!start) throw new Error(`Couldn't find the deal's start date property${process.env.HUBSPOT_START_PROP ? ` "${process.env.HUBSPOT_START_PROP}"` : " (program_start_date)"}. Set HUBSPOT_START_PROP in Vercel.`);
  const end = pick(process.env.HUBSPOT_END_PROP, ["training_end_date", "program_end_date"], /^(training|program) end date$/i);
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
/** A HubSpot date-time (like closedate) as the Eastern-time day it happened on: a deal won at 9pm on Oct 31 is an October sale. */
export function hsDateET(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = String(v).trim();
  const when = /^\d{10,}$/.test(t) ? new Date(Number(t)) : /^\d{4}-\d{2}-\d{2}T/.test(t) ? new Date(t) : null;
  if (!when || Number.isNaN(when.getTime())) return hsDate(t);
  return when.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // en-CA = YYYY-MM-DD
}

export function hsDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  if (/^\d{10,}$/.test(t)) return new Date(Number(t)).toISOString().slice(0, 10);
  return null;
}

// ── Contacts, associations, property definitions and writes (before-training checklist) ──
// Token scopes needed: crm.objects.deals.read/write, crm.objects.contacts.read/write, crm.schemas.deals.read, crm.schemas.contacts.read

export type PropDef = { name: string; label: string; type: string; fieldType: string; options: { label: string; value: string; hidden?: boolean }[] };
const defCache: Record<string, { at: number; defs: Map<string, PropDef> }> = {};
/** All property definitions of an object type (contacts / deals), cached for an hour. */
export async function propDefs(object: "contacts" | "deals"): Promise<Map<string, PropDef>> {
  const c = defCache[object];
  if (c && Date.now() - c.at < 3600e3) return c.defs;
  const { results } = await hs<{ results: PropDef[] }>(`/crm/v3/properties/${object}?archived=false`);
  const defs = new Map(results.map((p) => [p.name, { ...p, options: (p.options || []).filter((o) => !o.hidden) }]));
  defCache[object] = { at: Date.now(), defs };
  return defs;
}

/** The HubSpot option value for a label ("Yes" → "true", "DHLPP" → "Dhlpp"…), matched case-insensitively. */
export function optionValue(def: PropDef | undefined, label: string): string | null {
  if (!def) return null;
  if (def.type === "bool") return /^(yes|true)$/i.test(label) ? "true" : /^(no|false)$/i.test(label) ? "false" : null;
  const l = label.trim().toLowerCase();
  const o = def.options.find((x) => x.label.trim().toLowerCase() === l) || def.options.find((x) => x.value.trim().toLowerCase() === l);
  return o ? o.value : null;
}

export async function readContacts(ids: string[], properties: string[]): Promise<Map<string, DealProps>> {
  const out = new Map<string, DealProps>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 100) {
    const res = await hs<{ results?: { id: string; properties: DealProps }[] }>("/crm/v3/objects/contacts/batch/read", {
      method: "POST", body: JSON.stringify({ inputs: uniq.slice(i, i + 100).map((id) => ({ id })), properties })
    });
    for (const d of res.results || []) out.set(String(d.id), d.properties || {});
  }
  return out;
}

/** Every contact on each deal (a client can end up as two contacts when a form link misses their email). */
export async function dealContacts(dealIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const uniq = [...new Set(dealIds.filter((id) => /^\d+$/.test(id)))];
  for (let i = 0; i < uniq.length; i += 100) {
    const res = await hs<{ results?: { from: { id: string }; to: { toObjectId: number | string }[] }[] }>("/crm/v4/associations/deals/contacts/batch/read", {
      method: "POST", body: JSON.stringify({ inputs: uniq.slice(i, i + 100).map((id) => ({ id })) })
    });
    for (const r of res.results || []) if (r.to?.length) out.set(String(r.from.id), [...new Set(r.to.map((t) => String(t.toObjectId)))]);
  }
  return out;
}

export async function updateContact(id: string, properties: Record<string, string>) {
  await hs(`/crm/v3/objects/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ properties }) });
}
export async function updateDeal(id: string, properties: Record<string, string>) {
  await hs(`/crm/v3/objects/deals/${id}`, { method: "PATCH", body: JSON.stringify({ properties }) });
}

// ── Owners (deal owners = sales people). Needs the crm.objects.owners.read scope. ──
export type Owner = { id: string; email: string; name: string; teams: string[] };
let ownerCache: { at: number; list: Owner[] } | null = null;
export async function listOwners(): Promise<Owner[]> {
  if (ownerCache && Date.now() - ownerCache.at < 3600e3) return ownerCache.list;
  const list: Owner[] = [];
  let after = "";
  for (let i = 0; i < 10; i++) {
    const res = await hs<{ results: { id: string; email: string; firstName?: string; lastName?: string; teams?: { name: string }[] }[]; paging?: { next?: { after: string } } }>(`/crm/v3/owners?limit=500${after ? `&after=${after}` : ""}`);
    list.push(...res.results.map((o) => ({ id: String(o.id), email: (o.email || "").toLowerCase(), name: `${o.firstName || ""} ${o.lastName || ""}`.trim() || o.email, teams: (o.teams || []).map((t) => t.name) })));
    if (!res.paging?.next?.after) break;
    after = res.paging.next.after;
  }
  ownerCache = { at: Date.now(), list };
  return list;
}
/** The sales team: owners in a HubSpot team named like HUBSPOT_SALES_TEAM (default: any team with "sales" in its name). */
export async function salesTeam(): Promise<Owner[]> {
  const want = (process.env.HUBSPOT_SALES_TEAM || "sales").toLowerCase();
  return (await listOwners()).filter((o) => o.teams.some((t) => t.toLowerCase().includes(want)));
}

// ── Closed Won deals since a date (the "Closed Won, not booked" check) ──
type SearchPage = { results: { id: string; properties: DealProps }[]; paging?: { next?: { after: string } } };
/** Midnight Eastern on a date, as epoch ms (HubSpot's closedate is a moment, the business runs on Eastern time). */
function etMidnightMs(date: string): number {
  for (const off of [4, 5]) {
    const t = new Date(`${date}T0${off}:00:00Z`);
    const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(t));
    if (h === 0) return t.getTime();
  }
  return Date.parse(`${date}T05:00:00Z`);
}
/** Closed Won deals with a close date on or after `since` (YYYY-MM-DD, Eastern). Up to 3,000. */
export async function closedWonSince(since: string, properties: string[]): Promise<{ id: string; properties: DealProps }[]> {
  const from = String(etMidnightMs(since));
  const props = [...new Set([...properties, "hs_is_closed_won", "closedate", "dealname"])];
  const run = async (withWonFilter: boolean) => {
    const out: { id: string; properties: DealProps }[] = [];
    let after: string | undefined;
    for (let page = 0; page < 30; page++) {
      const filters = [{ propertyName: "closedate", operator: "GTE", value: from }, ...(withWonFilter ? [{ propertyName: "hs_is_closed_won", operator: "EQ", value: "true" }] : [])];
      const res = await hs<SearchPage>("/crm/v3/objects/deals/search", {
        method: "POST", body: JSON.stringify({ filterGroups: [{ filters }], properties: props, sorts: [{ propertyName: "closedate", direction: "ASCENDING" }], limit: 100, ...(after ? { after } : {}) })
      });
      out.push(...(res.results || []).map((r) => ({ id: String(r.id), properties: r.properties || {} })));
      after = res.paging?.next?.after;
      if (!after) break;
    }
    return out;
  };
  // Filtering on "is closed won" keeps the search small; if this portal won't filter on it, filter here instead
  const all = await run(true).catch(() => run(false));
  return all.filter((d) => d.properties.hs_is_closed_won === "true");
}

/** Deals lost between two dates (Eastern): closed lost, "No Trainers Available" and "Cancelled/Refunded", with why. For Pulse. */
export async function lostDealsBetween(from: string, to: string): Promise<{ id: string; properties: DealProps }[]> {
  const LOST_STAGES = ["173324394", "173376666", "1166729018", "93900622", "142034212", "107667607"];
  const out: { id: string; properties: DealProps }[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await hs<SearchPage>("/crm/v3/objects/deals/search", {
      method: "POST", body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: "closedate", operator: "GTE", value: String(etMidnightMs(from)) },
          { propertyName: "closedate", operator: "LT", value: String(etMidnightMs(addDays(to, 1))) },
          { propertyName: "dealstage", operator: "IN", values: LOST_STAGES }
        ] }],
        properties: ["dealname", "amount", "closedate", "dealstage", "closed_lost_reason_new", "trainer_in_range", "type_of_program_sold", "lead_source"],
        sorts: [{ propertyName: "closedate", direction: "DESCENDING" }], limit: 100, ...(after ? { after } : {})
      })
    });
    out.push(...(res.results || []).map((r) => ({ id: String(r.id), properties: r.properties || {} })));
    after = res.paging?.next?.after;
    if (!after) break;
  }
  return out;
}

/**
 * Deals created between two dates (Eastern), newest first, with what Pulse needs: where they're from (deal name carries
 * city, state, ZIP), their stage, amount, Bark credits and source. Capped at `maxPages` × 100 so the page stays quick;
 * `total` is HubSpot's full count for the range so the cap is visible.
 */
export async function dealsCreatedBetween(from: string, to: string, maxPages = 20): Promise<{ rows: { id: string; properties: DealProps }[]; total: number; capped: boolean }> {
  const rows: { id: string; properties: DealProps }[] = [];
  let after: string | undefined, total = 0, page = 0;
  for (; page < maxPages; page++) {
    const res = await hs<SearchPage & { total?: number }>("/crm/v3/objects/deals/search", {
      method: "POST", body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: "createdate", operator: "GTE", value: String(etMidnightMs(from)) },
          { propertyName: "createdate", operator: "LT", value: String(etMidnightMs(addDays(to, 1))) }
        ] }],
        properties: ["dealname", "amount", "createdate", "closedate", "dealstage", "pipeline", "hs_is_closed_won", "bark_credits_paid", "lead_source", "deal_source", "closed_lost_reason_new", "trainer_in_range", "type_of_program_sold"],
        sorts: [{ propertyName: "createdate", direction: "DESCENDING" }], limit: 100, ...(after ? { after } : {})
      })
    });
    total = res.total ?? total;
    rows.push(...(res.results || []).map((r) => ({ id: String(r.id), properties: r.properties || {} })));
    after = res.paging?.next?.after;
    if (!after) break;
  }
  return { rows, total: Math.max(total, rows.length), capped: !!after };
}

/** How many records match, without fetching them (HubSpot's `total`): deals created by an owner, calls made, emails sent… */
export async function countObjects(object: "deals" | "calls" | "emails" | "meetings", filters: { propertyName: string; operator: string; value?: string; values?: string[] }[]): Promise<number> {
  const res = await hs<{ total?: number }>(`/crm/v3/objects/${object}/search`, { method: "POST", body: JSON.stringify({ filterGroups: [{ filters }], properties: ["hs_object_id"], limit: 1 }) });
  return res.total || 0;
}
/** Closed Won deals with a close date inside [from, to] (Eastern), up to `maxPages` × 100. For "same range last year" and "next month, last year". */
export async function closedWonBetween(from: string, to: string, maxPages = 5): Promise<{ rows: { id: string; properties: DealProps }[]; total: number }> {
  const rows: { id: string; properties: DealProps }[] = [];
  let after: string | undefined, total = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await hs<SearchPage & { total?: number }>("/crm/v3/objects/deals/search", {
      method: "POST", body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: "closedate", operator: "GTE", value: String(etMidnightMs(from)) }, { propertyName: "closedate", operator: "LT", value: String(etMidnightMs(addDays(to, 1))) },
          { propertyName: "hs_is_closed_won", operator: "EQ", value: "true" }
        ] }], properties: ["dealname", "amount", "closedate", "createdate", "hubspot_owner_id", "lead_source", "deal_source", "bark_credits_paid", "type_of_program_sold"], limit: 100, ...(after ? { after } : {})
      })
    });
    total = res.total ?? total;
    rows.push(...(res.results || []).map((r) => ({ id: String(r.id), properties: r.properties || {} })));
    after = res.paging?.next?.after;
    if (!after) break;
  }
  return { rows, total: Math.max(total, rows.length) };
}
/** Epoch ms for a date's Eastern midnight, for callers outside this file. */
export const etMidnight = (date: string) => etMidnightMs(date);

// ── Client form links ──
/** A contact's deals, newest first (by close date, else created). */
export async function contactDeals(contactId: string, properties: string[]): Promise<{ id: string; properties: DealProps }[]> {
  const res = await hs<{ results?: { toObjectId: number | string }[] }>(`/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/deals?limit=100`);
  const ids = (res.results || []).map((r) => String(r.toObjectId));
  if (!ids.length) return [];
  const deals = await readDeals(ids, [...new Set([...properties, "createdate", "closedate", "hs_is_closed_won", "hs_is_closed"])]);
  return [...deals.entries()].map(([id, properties]) => ({ id, properties }))
    .sort((a, b) => String(b.properties.createdate || "").localeCompare(String(a.properties.createdate || "")));
}

/** Contacts created on or after `sinceMs` that don't have `prop` set yet (up to `max`). */
export async function contactsMissing(prop: string, sinceMs: number, max = 500): Promise<string[]> {
  const out: string[] = [];
  let after: string | undefined;
  while (out.length < max) {
    const res = await hs<{ results?: { id: string }[]; paging?: { next?: { after: string } } }>("/crm/v3/objects/contacts/search", {
      method: "POST", body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: prop, operator: "NOT_HAS_PROPERTY" }, { propertyName: "createdate", operator: "GTE", value: String(sinceMs) }] }],
        properties: ["email"], sorts: [{ propertyName: "createdate", direction: "DESCENDING" }], limit: 100, ...(after ? { after } : {})
      })
    });
    out.push(...(res.results || []).map((r) => String(r.id)));
    after = res.paging?.next?.after;
    if (!after) break;
  }
  return out.slice(0, max);
}

/** Sets properties on many contacts at once (100 per call). */
export async function updateContacts(rows: { id: string; properties: Record<string, string> }[]) {
  for (let i = 0; i < rows.length; i += 100)
    await hs("/crm/v3/objects/contacts/batch/update", { method: "POST", body: JSON.stringify({ inputs: rows.slice(i, i + 100) }) });
}

/** The contact with exactly this email, if there is one. */
export async function contactByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const res = await hs<{ results?: { id: string; properties: { email?: string } }[] }>("/crm/v3/objects/contacts/search", {
    method: "POST", body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email.trim().toLowerCase() }] }], properties: ["email"], limit: 2 })
  });
  const r = (res.results || [])[0];
  return r ? { id: String(r.id), email: String(r.properties.email || email) } : null;
}
