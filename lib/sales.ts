import "server-only";
import { serviceClient, isDemo } from "./supabase";
import { listOwners, Owner, salesTeam } from "./hubspot";
import { remainingOf } from "./money";

// Sales come only from HubSpot: every Closed Won deal, in the Eastern-time month it was won, under the deal owner.
// Sale = the deal amount. Still owed = amount − amount paid (0 once the deal is marked Paid, Refund or Program Cancelled).
// Read every 30 minutes (lib/salesSync.ts) and with "Refresh from HubSpot". No sheets, no imports.

export type Sale = { key: string; seller: string; ownerId: string | null; client: string; program: string; amount: number; paid: number; remaining: number; status: string | null; link: string | null; dealId: string; closedOn: string };
export type Seller = { ownerId: string | null; name: string; count: number; amount: number; remaining: number; sales: Sale[] };
const round = (n: number) => Math.round(n * 100) / 100;
export const monthStart = (m: string) => `${m}-01`;
export const nextMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };

export async function owners(): Promise<Owner[]> { try { return await listOwners(); } catch { return []; } }
/** The HubSpot sales team (falls back to every owner if no team is found). Sheet names are matched against these. */
export async function salesPeople(): Promise<Owner[]> { try { const t = await salesTeam(); return t.length ? t : await owners(); } catch { return owners(); } }
/** The HubSpot owner whose email this is (a sales person's login email = their HubSpot email). */
export async function ownerByEmail(email: string | null | undefined): Promise<Owner | null> { if (!email) return null; const e = email.toLowerCase(); return (await owners()).find((o) => o.email === e) || null; }

export async function salesMonth(month: string, ownerId?: string): Promise<{ sellers: Seller[]; total: number; remaining: number; owed: number; count: number }> {
  const empty = { sellers: [], total: 0, remaining: 0, owed: 0, count: 0 };
  if (isDemo()) return empty;
  const sb = serviceClient(), from = monthStart(month), to = monthStart(nextMonth(month));
  let q = sb.from("deal_money").select("*").gte("closed_on", from).lt("closed_on", to);
  if (ownerId) q = q.eq("owner_id", ownerId);
  const [{ data: deals }, all] = await Promise.all([q, owners()]);
  const dealRows = (deals || []) as { deal_id: string; dealname: string | null; owner_id: string | null; amount: number; amount_paid: number; closed_on: string; payment_status: string | null; remaining_balance_link: string | null }[];
  const { data: bks } = dealRows.length ? await sb.from("bookings").select("hubspot_deal_id, client_name, dog_name, program").in("hubspot_deal_id", dealRows.map((d) => d.deal_id)) : { data: [] };
  const nameOf = (id: string | null) => all.find((o) => o.id === id)?.name || (id ? `Owner ${id}` : "No owner in HubSpot");
  const sales: Sale[] = dealRows.map((d): Sale => {
    const b = ((bks || []) as { hubspot_deal_id: string; client_name: string; dog_name: string | null; program: string | null }[]).filter((x) => x.hubspot_deal_id === d.deal_id);
    return { key: `d:${d.deal_id}`, seller: nameOf(d.owner_id), ownerId: d.owner_id, client: `${b[0]?.client_name || d.dealname || "Client"}${b.length ? ` (${b.map((x) => x.dog_name || "dog").join(" & ")})` : ""}`,
      program: b[0]?.program || "", amount: Number(d.amount) || 0, paid: Number(d.amount_paid) || 0,
      remaining: remainingOf({ amount: Number(d.amount), amount_paid: Number(d.amount_paid), payment_status: d.payment_status }),
      status: d.payment_status, link: d.remaining_balance_link, dealId: d.deal_id, closedOn: d.closed_on };
  }).sort((x, y) => y.closedOn.localeCompare(x.closedOn));
  const map = new Map<string, Seller>();
  for (const s of sales) {
    const k = s.ownerId || `name:${s.seller}`;
    const x = map.get(k) || { ownerId: s.ownerId, name: s.seller, count: 0, amount: 0, remaining: 0, sales: [] };
    x.count++; x.amount = round(x.amount + s.amount); x.remaining = round(x.remaining + s.remaining); x.sales.push(s);
    map.set(k, x);
  }
  const sellers = [...map.values()].sort((a, b) => b.amount - a.amount);
  return { sellers, total: round(sellers.reduce((n, s) => n + s.amount, 0)), remaining: round(sellers.reduce((n, s) => n + s.remaining, 0)), owed: sales.filter((x) => x.remaining > 0).length, count: sales.length };
}

/** This month and the 5 before it, newest first ("2026-10"). */
export const recentMonths = (now: string, n = 6) => { const [y, m] = now.split("-").map(Number); return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - i, 1)); return d.toISOString().slice(0, 7); }); };
