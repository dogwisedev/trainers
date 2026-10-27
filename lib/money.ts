import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, isDemo } from "./supabase";
import { DealProps, closedWonSince, hsDate, hsDateET, hubspotConfigured, optionValue, propDefs, readDeals, updateDeal } from "./hubspot";
import { createRemainingLink, deactivateLink, stripeConfigured } from "./stripe";
import { addDays } from "./dates";
import { etParts } from "./chatRules";

// Each deal's money, from HubSpot: the sale (amount), what's paid, the balance link, follow-up session dates.
// Which deals: every Closed Won deal since the sheet cut-over (booked in the app or not, so Sales is right the day a deal
// is won), plus every booked deal. Close dates are Eastern time. Stripe links are only made for deals booked in the app.
// Refreshed by the 30-minute cron. Stripe links: only for Closed Won deals closed on/after STRIPE_LINKS_FROM,
// with something still owed, not marked Paid/Refund/Program Cancelled, and no link in HubSpot already (a manual link always wins).

export const FOLLOWUP_PROPS = ["follow_up_session__1", "follow_up_session__2", "follow_up_session__3"];
const PROPS = ["amount", "amount_paid", "closedate", "hubspot_owner_id", "dealname", "payment_status", "remaining_balance_link", "hs_is_closed_won", "k9___dog_name", ...FOLLOWUP_PROPS];
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
export const paidUp = (status: unknown) => /^(paid|refund|program cancelled)$/i.test(String(status || "").trim());
export const remainingOf = (m: { amount: number | null; amount_paid: number | null; payment_status?: string | null }) =>
  paidUp(m.payment_status) ? 0 : Math.max(0, Math.round(((m.amount || 0) - (m.amount_paid || 0)) * 100) / 100);

export type MoneyResult = { deals: number; won: number; links: string[]; errors: string[] };

export async function syncMoney(opts: { dealIds?: string[]; sb?: SupabaseClient } = {}): Promise<MoneyResult> {
  const out: MoneyResult = { deals: 0, won: 0, links: [], errors: [] };
  if (isDemo() || !hubspotConfigured()) return out;
  const sb = opts.sb || serviceClient();
  const since = addDays(etParts(new Date()).date, -400);
  let q = sb.from("bookings").select("hubspot_deal_id, dog_name, client_name").not("hubspot_deal_id", "is", null).gte("end_date", since);
  if (opts.dealIds?.length) q = q.in("hubspot_deal_id", opts.dealIds);
  const { data: bks } = await q;
  const booked = new Set(((bks || []) as { hubspot_deal_id: string }[]).map((b) => b.hubspot_deal_id).filter((x) => /^\d+$/.test(x)));
  let ids = [...booked];
  if (!opts.dealIds?.length) {
    // Every Closed Won deal since the Monies sheet cut-over (or the last 400 days), and any deal already counted (to drop ones no longer won)
    const { data: st } = await sb.from("app_state").select("value").eq("key", "sales_import_through").maybeSingle();
    const today = etParts(new Date()).date;
    const sixMonths = `${addDays(today.slice(0, 7) + "-01", -160).slice(0, 7)}-01`; // the first day of the oldest month on the Sales page
    const through = (st?.value as string | undefined) || null;
    const from = through && through < sixMonths ? through : sixMonths;
    try { ids.push(...(await closedWonSince(from, [])).map((d) => d.id)); } catch (e) { out.errors.push(`closed won search: ${(e as Error).message}`); }
    const { data: counted } = await sb.from("deal_money").select("deal_id").gte("closed_on", from);
    ids.push(...((counted || []) as { deal_id: string }[]).map((r) => r.deal_id));
    ids = [...new Set(ids.filter((x) => /^\d+$/.test(x)))];
  }
  if (!ids.length) return out;
  let deals: Map<string, DealProps>;
  try { deals = await readDeals(ids, PROPS); } catch (e) { out.errors.push((e as Error).message); return out; }
  const { data: old } = await sb.from("deal_money").select("deal_id, link_by_app, amount, link_amount, link_id").in("deal_id", ids);
  type Prev = { deal_id: string; link_by_app: boolean; amount: number | null; link_amount: number | null; link_id: string | null };
  const prevOf = new Map(((old || []) as Prev[]).map((r) => [r.deal_id, r]));
  const byApp = new Map([...prevOf.values()].map((r) => [r.deal_id, r.link_by_app]));
  const linksFrom = process.env.STRIPE_LINKS_FROM || "";
  // Saved in batches (fast, and what's done is kept even if the run is cut short); any save error is reported, never ignored
  const batch: Record<string, unknown>[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const rows = batch.splice(0, batch.length);
    const { error } = await sb.from("deal_money").upsert(rows);
    if (error) out.errors.push(`saving ${rows.length} deals: ${error.message}`); else out.deals += rows.length;
  };
  for (const id of ids) {
    const p = deals.get(id);
    if (!p) continue;
    const won = p.hs_is_closed_won === "true";
    const row = {
      deal_id: id, dealname: p.dealname || null, owner_id: p.hubspot_owner_id || null, amount: num(p.amount), amount_paid: num(p.amount_paid),
      closed_on: won ? hsDateET(p.closedate) : null, payment_status: p.payment_status || null, remaining_balance_link: (p.remaining_balance_link || "").trim() || null,
      link_by_app: byApp.get(id) || false, link_amount: prevOf.get(id)?.link_amount ?? null, link_id: prevOf.get(id)?.link_id ?? null, followups: FOLLOWUP_PROPS.map((k) => hsDate(p[k])).filter((x): x is string => !!x), synced_at: new Date().toISOString()
    };
    // Stripe link for the remaining balance
    //  New: a won deal (closed on/after STRIPE_LINKS_FROM) with something owed and no link yet.
    //  Extension: the deal's amount went UP since the app last saw it, and something is owed again. The app replaces its own
    //  old link (switching it off in Stripe) and sets payment_status back to "Remaining Balance Due". A link someone put in by hand is never replaced.
    const prev = prevOf.get(id);
    const owedNow = Math.max(0, Math.round((row.amount - row.amount_paid) * 100) / 100);
    const isBooked = booked.has(id); // balance links only for deals booked in the app (as before)
    const extended = isBooked && !!prev && prev.amount != null && row.amount > Number(prev.amount) + 0.5 && owedNow >= 1 && (!row.remaining_balance_link || row.link_by_app);
    const fresh = isBooked && linksFrom && won && row.closed_on && row.closed_on >= linksFrom && remainingOf(row) >= 1 && !row.remaining_balance_link;
    if (stripeConfigured() && won && (fresh || extended)) {
      try {
        const b = ((bks || []) as { hubspot_deal_id: string; dog_name: string | null; client_name: string }[]).find((x) => x.hubspot_deal_id === id);
        const amount = extended ? owedNow : remainingOf(row);
        if (extended && row.link_id) await deactivateLink(row.link_id).catch(() => {});
        const link = await createRemainingLink({ dealId: id, amount, label: `${p.k9___dog_name || b?.dog_name || "training"} (${b?.client_name || p.dealname || id})` });
        const props: Record<string, string> = { remaining_balance_link: link.url };
        if (extended && paidUp(row.payment_status)) {
          const due = optionValue((await propDefs("deals")).get("payment_status"), "Remaining Balance Due");
          if (due) { props.payment_status = due; row.payment_status = due; }
        }
        await updateDeal(id, props);
        row.remaining_balance_link = link.url; row.link_by_app = true; row.link_amount = amount; row.link_id = link.id;
        out.links.push(`${p.dealname || id}: $${amount}${extended ? " (extension)" : ""}`);
      } catch (e) { out.errors.push(`link ${id}: ${(e as Error).message}`); }
    }
    if (row.closed_on) out.won++;
    batch.push(row);
    if (batch.length >= 100) await flush();
  }
  await flush();
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
