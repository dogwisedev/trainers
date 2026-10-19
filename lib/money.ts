import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, isDemo } from "./supabase";
import { DealProps, hsDate, hubspotConfigured, optionValue, propDefs, readDeals, updateDeal } from "./hubspot";
import { createRemainingLink, stripeConfigured } from "./stripe";
import { addDays } from "./dates";
import { etParts } from "./chatRules";

// Each booked deal's money, from HubSpot: the sale (amount), what's paid, the balance link, follow-up session dates.
// Refreshed by the 30-minute cron. Stripe links: only for Closed Won deals closed on/after STRIPE_LINKS_FROM,
// with something still owed, not marked Paid/Refund/Program Cancelled, and no link in HubSpot already (a manual link always wins).

export const FOLLOWUP_PROPS = ["follow_up_session__1", "follow_up_session__2", "follow_up_session__3"];
const PROPS = ["amount", "amount_paid", "closedate", "hubspot_owner_id", "dealname", "payment_status", "remaining_balance_link", "hs_is_closed_won", "k9___dog_name", ...FOLLOWUP_PROPS];
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
export const paidUp = (status: unknown) => /^(paid|refund|program cancelled)$/i.test(String(status || "").trim());
export const remainingOf = (m: { amount: number | null; amount_paid: number | null; payment_status?: string | null }) =>
  paidUp(m.payment_status) ? 0 : Math.max(0, Math.round(((m.amount || 0) - (m.amount_paid || 0)) * 100) / 100);

export type MoneyResult = { deals: number; links: string[]; errors: string[] };

export async function syncMoney(opts: { dealIds?: string[]; sb?: SupabaseClient } = {}): Promise<MoneyResult> {
  const out: MoneyResult = { deals: 0, links: [], errors: [] };
  if (isDemo() || !hubspotConfigured()) return out;
  const sb = opts.sb || serviceClient();
  const since = addDays(etParts(new Date()).date, -400);
  let q = sb.from("bookings").select("hubspot_deal_id, dog_name, client_name").not("hubspot_deal_id", "is", null).gte("end_date", since);
  if (opts.dealIds?.length) q = q.in("hubspot_deal_id", opts.dealIds);
  const { data: bks } = await q;
  const ids = [...new Set(((bks || []) as { hubspot_deal_id: string }[]).map((b) => b.hubspot_deal_id).filter((x) => /^\d+$/.test(x)))];
  if (!ids.length) return out;
  let deals: Map<string, DealProps>;
  try { deals = await readDeals(ids, PROPS); } catch (e) { out.errors.push((e as Error).message); return out; }
  const { data: old } = await sb.from("deal_money").select("deal_id, link_by_app").in("deal_id", ids);
  const byApp = new Map(((old || []) as { deal_id: string; link_by_app: boolean }[]).map((r) => [r.deal_id, r.link_by_app]));
  const linksFrom = process.env.STRIPE_LINKS_FROM || "";
  for (const id of ids) {
    const p = deals.get(id);
    if (!p) continue;
    const won = p.hs_is_closed_won === "true";
    const row = {
      deal_id: id, dealname: p.dealname || null, owner_id: p.hubspot_owner_id || null, amount: num(p.amount), amount_paid: num(p.amount_paid),
      closed_on: won ? hsDate(p.closedate) : null, payment_status: p.payment_status || null, remaining_balance_link: (p.remaining_balance_link || "").trim() || null,
      link_by_app: byApp.get(id) || false, followups: FOLLOWUP_PROPS.map((k) => hsDate(p[k])).filter((x): x is string => !!x), synced_at: new Date().toISOString()
    };
    // Stripe link for the remaining balance
    const owed = remainingOf(row);
    if (stripeConfigured() && linksFrom && won && row.closed_on && row.closed_on >= linksFrom && owed >= 1 && !row.remaining_balance_link) {
      try {
        const b = ((bks || []) as { hubspot_deal_id: string; dog_name: string | null; client_name: string }[]).find((x) => x.hubspot_deal_id === id);
        const url = await createRemainingLink({ dealId: id, amount: owed, label: `${p.k9___dog_name || b?.dog_name || "training"} (${b?.client_name || p.dealname || id})` });
        await updateDeal(id, { remaining_balance_link: url });
        row.remaining_balance_link = url; row.link_by_app = true;
        out.links.push(`${p.dealname || id}: $${owed}`);
      } catch (e) { out.errors.push(`link ${id}: ${(e as Error).message}`); }
    }
    await sb.from("deal_money").upsert(row);
    out.deals++;
  }
  return out;
}

/** A Stripe payment for a deal: add it to amount_paid, and mark the deal Paid once nothing is owed. */
export async function recordPayment(dealId: string, amount: number, sessionId: string, sb: SupabaseClient = serviceClient()) {
  const { error: dup } = await sb.from("stripe_payments").insert({ session_id: sessionId, deal_id: dealId, amount });
  if (dup) return { ok: true, note: "already counted" };
  const p = (await readDeals([dealId], ["amount", "amount_paid", "payment_status"])).get(dealId);
  if (!p) return { ok: false, note: "deal not found" };
  const paid = Math.round((num(p.amount_paid) + amount) * 100) / 100;
  const props: Record<string, string> = { amount_paid: String(paid) };
  if (num(p.amount) - paid <= 0.009) {
    const v = optionValue((await propDefs("deals")).get("payment_status"), "Paid");
    if (v) props.payment_status = v;
  }
  await updateDeal(dealId, props);
  await syncMoney({ dealIds: [dealId], sb });
  return { ok: true, note: `amount_paid now ${paid}` };
}
