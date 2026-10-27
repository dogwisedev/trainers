import "server-only";
import { serviceClient, isDemo } from "./supabase";
import { listOwners, Owner, salesTeam } from "./hubspot";
import { remainingOf } from "./money";

// Sales: every Closed Won deal in HubSpot (booked in the app or not), in the Eastern-time month it was won, per deal owner.
// Sale = the deal amount (whatever has been paid); remaining = amount − amount paid (0 once Paid).
// Before the app: rows pasted from the Monies sheet (sales_import), which cover sales up to "sales_import_through".

export type Sale = { key: string; seller: string; ownerId: string | null; client: string; program: string; amount: number; remaining: number | null; link: string | null; dealId: string | null; closedOn: string | null; source: "app" | "sheet" };
export type Seller = { ownerId: string | null; name: string; count: number; amount: number; remaining: number; sales: Sale[] };
const round = (n: number) => Math.round(n * 100) / 100;
export const monthStart = (m: string) => `${m}-01`;
export const nextMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };

export async function owners(): Promise<Owner[]> { try { return await listOwners(); } catch { return []; } }
/** The HubSpot sales team (falls back to every owner if no team is found). Sheet names are matched against these. */
export async function salesPeople(): Promise<Owner[]> { try { const t = await salesTeam(); return t.length ? t : await owners(); } catch { return owners(); } }
/** The HubSpot owner whose email this is (a sales person's login email = their HubSpot email). */
export async function ownerByEmail(email: string | null | undefined): Promise<Owner | null> { if (!email) return null; const e = email.toLowerCase(); return (await owners()).find((o) => o.email === e) || null; }

/** A name from the Monies sheet ("Ariane", "James S", "Paul Faronbi") → the HubSpot owner, if exactly one fits.
 *  Checked against full name, first name, and the email's first part (ariane@… ↔ "Ariane"). */
export function matchOwner(name: string, all: Owner[]): string | null {
  const n = name.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return null;
  const first = n.split(" ")[0], squashed = n.replace(/ /g, "");
  const tests: ((o: Owner) => boolean)[] = [
    (o) => o.name.toLowerCase() === n,
    (o) => { const local = o.email.split("@")[0].replace(/[^a-z]/g, ""); return local === squashed || local === first; },
    (o) => o.name.toLowerCase().split(/\s+/)[0] === first
  ];
  for (const t of tests) { const m = all.filter(t); if (m.length === 1) return m[0].id; }
  return null;
}

export async function salesMonth(month: string, ownerId?: string): Promise<{ sellers: Seller[]; total: number; remaining: number; count: number; importedThrough: string | null }> {
  const empty = { sellers: [], total: 0, remaining: 0, count: 0, importedThrough: null };
  if (isDemo()) return empty;
  const sb = serviceClient(), from = monthStart(month), to = monthStart(nextMonth(month));
  const [{ data: st }, { data: imp }, all] = await Promise.all([
    sb.from("app_state").select("value").eq("key", "sales_import_through").maybeSingle(),
    sb.from("sales_import").select("*").eq("month", from),
    owners()
  ]);
  const team = await salesPeople();
  const through = (st?.value as string | undefined) || null;
  // A month entirely after the cut-over comes only from the app: its pasted rows are ignored (no double counting)
  // Pasted rows count only for months up to the cut-over; with no cut-over, everything comes from HubSpot (no double counting)
  const useSheet = !!through && from <= through;
  const fixed = ((useSheet ? imp || [] : []) as { id: string; seller: string; owner_id: string | null }[]).filter((r) => !r.owner_id).map((r) => ({ id: r.id, owner: matchOwner(r.seller, team) })).filter((r) => r.owner);
  for (const r of fixed) await sb.from("sales_import").update({ owner_id: r.owner }).eq("id", r.id);
  let q = sb.from("deal_money").select("*").gte("closed_on", from).lt("closed_on", to);
  if (through) q = q.gt("closed_on", through);
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data: deals } = await q;
  const dealRows = (deals || []) as { deal_id: string; dealname: string | null; owner_id: string | null; amount: number; amount_paid: number; closed_on: string; payment_status: string | null; remaining_balance_link: string | null }[];
  const { data: bks } = dealRows.length ? await sb.from("bookings").select("hubspot_deal_id, client_name, dog_name, program").in("hubspot_deal_id", dealRows.map((d) => d.deal_id)) : { data: [] };
  const nameOf = (id: string | null) => all.find((o) => o.id === id)?.name || (id ? `Owner ${id}` : "No owner");
  const sales: Sale[] = [
    ...dealRows.map((d): Sale => {
      const b = ((bks || []) as { hubspot_deal_id: string; client_name: string; dog_name: string | null; program: string | null }[]).filter((x) => x.hubspot_deal_id === d.deal_id);
      return { key: `d:${d.deal_id}`, seller: nameOf(d.owner_id), ownerId: d.owner_id, client: `${b[0]?.client_name || d.dealname || "Client"}${b.length ? ` (${b.map((x) => x.dog_name || "dog").join(" & ")})` : ""}`,
        program: b[0]?.program || "", amount: Number(d.amount) || 0, remaining: remainingOf({ amount: Number(d.amount), amount_paid: Number(d.amount_paid), payment_status: d.payment_status }),
        link: d.remaining_balance_link, dealId: d.deal_id, closedOn: d.closed_on, source: "app" };
    }),
    ...((useSheet ? imp || [] : []) as { id: string; seller: string; owner_id: string | null; client: string | null; program: string | null; amount: number; paid_in_full: boolean | null }[])
      .map((r) => ({ ...r, owner_id: r.owner_id || matchOwner(r.seller, team) }))   // rows imported before a match was found
      .filter((r) => !ownerId || r.owner_id === ownerId)
      .map((r): Sale => ({ key: `s:${r.id}`, seller: r.owner_id ? nameOf(r.owner_id) : r.seller, ownerId: r.owner_id, client: r.client || "", program: r.program || "", amount: Number(r.amount) || 0,
        remaining: r.paid_in_full ? 0 : null, link: null, dealId: null, closedOn: null, source: "sheet" }))
  ];
  const map = new Map<string, Seller>();
  for (const s of sales) {
    const k = s.ownerId || `name:${s.seller}`;
    const x = map.get(k) || { ownerId: s.ownerId, name: s.seller, count: 0, amount: 0, remaining: 0, sales: [] };
    x.count++; x.amount = round(x.amount + s.amount); x.remaining = round(x.remaining + (s.remaining || 0)); x.sales.push(s);
    map.set(k, x);
  }
  const sellers = [...map.values()].sort((a, b) => b.amount - a.amount);
  return { sellers, total: round(sellers.reduce((n, s) => n + s.amount, 0)), remaining: round(sellers.reduce((n, s) => n + s.remaining, 0)), count: sales.length, importedThrough: through };
}

/** Rows copied from the Monies sheet's Sales tab (Name, Client, Program sold, Total amount, 7%, Paid in full?, …). A name on its own row carries down (merged cells). */
export function parseSheetSales(text: string): { seller: string; client: string; program: string; amount: number; paidInFull: boolean }[] {
  const out: { seller: string; client: string; program: string; amount: number; paidInFull: boolean }[] = [];
  let seller = "";
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = (line.includes("\t") ? line.split("\t") : line.split(",")).map((x) => x.trim());
    if (c[0]) seller = c[0];
    const amount = Number((c[3] || "").replace(/[$,\s]/g, ""));
    if (!seller || !Number.isFinite(amount) || amount <= 0 || /^name$/i.test(c[0])) continue;
    out.push({ seller, client: c[1] || "", program: c[2] || "", amount, paidInFull: /^(yes|y|true|paid)$/i.test(c[5] || "") });
  }
  return out;
}

/** This month and the 5 before it, newest first ("2026-10"). */
export const recentMonths = (now: string, n = 6) => { const [y, m] = now.split("-").map(Number); return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - i, 1)); return d.toISOString().slice(0, 7); }); };
