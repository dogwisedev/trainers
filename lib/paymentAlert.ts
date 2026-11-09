import "server-only";
import { isDemo, serviceClient } from "./supabase";
import { contactByEmail, contactDeals, hubspotConfigured, listOwners, readDeals, type DealProps } from "./hubspot";
import { stripeConfigured, stripeGet } from "./stripe";
import { long } from "./dates";
import { etParts } from "./chatRules";
import { buzzOn, md, mdLink, postToBuzz } from "./buzz";

// Stripe payments → the Buzz payments channel, side by side with the Slack alert (barktoHubSpot posts that one, unchanged).
// The upgrade over Slack: one message that says which dog and trainer it's for, what's still owed (when that's certain),
// and what to do next, with the dog's page in the app and the HubSpot deal one tap away.
//   charge.succeeded  a payment that isn't the app's balance link (deposits, invoices, links sales made)
//   charge.failed     any failed payment, with the reason in plain words and the balance link to resend
//   balance paid      the app's own balance link, posted after the payment is added to HubSpot, so "still owed" is exact
// "Still owed" is only shown for balance-link payments: for other payments HubSpot's amount_paid is updated by hand,
// often after the alert, so a figure there could be wrong.

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const dealUrl = (id: string) => `https://app.hubspot.com/contacts/21869370/record/0-3/${id}`;
const contactUrl = (id: string) => `https://app.hubspot.com/contacts/21869370/record/0-1/${id}`;
const dollars = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (cents: number, currency: string) => (currency.toLowerCase() === "usd" ? dollars(cents / 100) : `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`);
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };

export type StripeCharge = {
  id: string; amount: number; currency: string;
  billing_details?: { email?: string | null; name?: string | null } | null;
  receipt_email?: string | null; customer?: string | null; payment_intent?: string | null;
  metadata?: Record<string, string> | null;
  failure_code?: string | null; failure_message?: string | null;
  outcome?: { reason?: string | null; seller_message?: string | null } | null;
};

type Booking = {
  id: string; dog_name: string | null; client_name: string | null; program: string | null; program_choice: string | null; weeks: number | null;
  start_date: string; end_date: string; status: string; trainers: { name: string } | { name: string }[] | null;
};
type Ctx = { dealId: string | null; deal: DealProps | null; contactId: string | null; bookings: Booking[]; owner: string | null };

const DEAL_PROPS = ["dealname", "amount", "amount_paid", "hubspot_owner_id", "remaining_balance_link", "hs_is_closed", "hs_is_closed_won"];

/** The deal (given, or the client's newest deal that isn't Closed Lost), its bookings in the app, and the sales owner. Each part
 *  that fails is just left out: a thinner message beats no message. */
async function contextFor(o: { dealId?: string | null; email?: string | null }): Promise<Ctx> {
  const ctx: Ctx = { dealId: o.dealId || null, deal: null, contactId: null, bookings: [], owner: null };
  if (!hubspotConfigured()) return ctx;
  try {
    if (ctx.dealId) ctx.deal = (await readDeals([ctx.dealId], DEAL_PROPS)).get(ctx.dealId) || null;
    else if (o.email) {
      const c = await contactByEmail(o.email);
      if (c) {
        ctx.contactId = c.id;
        const deals = await contactDeals(c.id, DEAL_PROPS); // newest first
        const lost = (p: DealProps) => p.hs_is_closed === "true" && p.hs_is_closed_won !== "true";
        const pick = deals.find((d) => !lost(d.properties)) || deals[0];
        if (pick) { ctx.dealId = pick.id; ctx.deal = pick.properties; }
      }
    }
  } catch (e) { console.error("payment alert: HubSpot", (e as Error).message); }
  if (ctx.dealId && !isDemo()) {
    const { data, error } = await serviceClient().from("bookings")
      .select("id, dog_name, client_name, program, program_choice, weeks, start_date, end_date, status, trainers(name)")
      .eq("hubspot_deal_id", ctx.dealId).order("start_date");
    if (error) console.error("payment alert: bookings", error.message);
    const all = (data || []) as unknown as Booking[];
    const live = all.filter((b) => b.status !== "cancelled");
    ctx.bookings = (live.length ? live : all).slice(0, 4);
  }
  const ownerId = ctx.deal?.hubspot_owner_id;
  if (ownerId) {
    try { ctx.owner = (await listOwners()).find((x) => x.id === String(ownerId))?.name || null; } catch { /* name is a nice-to-have */ }
  }
  return ctx;
}

const trainerName = (b: Booking) => (Array.isArray(b.trainers) ? b.trainers[0]?.name : b.trainers?.name) || "";

function bookingLine(b: Booking, today: string) {
  const when = b.status === "cancelled" ? "cancelled"
    : today < b.start_date ? `starts ${long(b.start_date)}`
    : today <= b.end_date ? `in training until ${long(b.end_date)}`
    : `finished ${long(b.end_date)}`;
  const program = b.program || b.program_choice || (b.weeks ? `${b.weeks} weeks` : "");
  const trainer = trainerName(b);
  return [`**${mdLink(b.dog_name || "Dog", `${site()}/a/dogs/${b.id}`)}**`, md(program), trainer ? `with ${md(trainer)}` : "no trainer yet", when].filter(Boolean).join(" · ");
}

/** The dog lines, or what's missing and the one link that fixes it. */
function whereLines(ctx: Ctx, email: string | null) {
  const today = etParts(new Date()).date;
  if (ctx.bookings.length) return ctx.bookings.map((b) => bookingLine(b, today));
  if (ctx.dealId && ctx.deal) return [ctx.deal.hs_is_closed_won === "true"
    ? `Not booked in the app yet · ${mdLink("Book it", `${site()}/a/bookings/new?deal=${ctx.dealId}`)}`
    : "Deal not Closed Won yet, so not booked in the app"];
  if (ctx.dealId) return [`Deal ${md(ctx.dealId)} couldn't be read from HubSpot`];
  if (ctx.contactId) return [`No HubSpot deal for this client yet · ${mdLink("Open the contact", contactUrl(ctx.contactId))}`];
  return [email ? `No HubSpot contact for ${md(email)} yet` : "No email on this payment, so no HubSpot match"];
}

const footer = (ctx: Ctx) => [ctx.owner ? `Sales: ${md(ctx.owner)}` : "", ctx.dealId ? mdLink("HubSpot deal", dealUrl(ctx.dealId)) : ""].filter(Boolean).join(" · ");

const clientName = (ctx: Ctx, stripeName?: string | null, email?: string | null) =>
  ctx.bookings.find((b) => b.client_name)?.client_name || stripeName || email || "Unknown client";

/** A decline in plain words for the office. Unknown reasons fall back to Stripe's own sentence. */
function declineReason(ch: StripeCharge) {
  const code = String(ch.outcome?.reason || ch.failure_code || "").toLowerCase();
  const provider = code.match(/^([a-z]+)_checkout_cancel+ed/)?.[1];
  if (provider) return `The client cancelled the ${provider[0].toUpperCase()}${provider.slice(1)} checkout. No money moved.`;
  const plain: [RegExp, string][] = [
    [/insufficient_funds/, "Not enough money on the card."],
    [/card_velocity_exceeded|withdrawal_count_limit_exceeded/, "The card's spending limit is reached."],
    [/expired_card/, "The card has expired."],
    [/incorrect_cvc|invalid_cvc/, "Wrong security code (CVC)."],
    [/incorrect_number|invalid_number/, "Wrong card number."],
    [/incorrect_zip/, "The billing ZIP code didn't match."],
    [/lost_card|stolen_card|pickup_card/, "The bank says the card is lost or stolen."],
    [/fraudulent|highest_risk_level|elevated_risk_level|merchant_blacklist/, "Blocked as possible fraud."],
    [/authentication_required/, "The client has to confirm it with their bank (card security check)."],
    [/processing_error|issuer_not_available|try_again_later|reenter_transaction/, "A bank system error. Trying again usually works."],
    [/card_not_supported|currency_not_supported/, "This card can't be used for this payment."],
    [/do_not_honor|generic_decline|card_declined|call_issuer|transaction_not_allowed|not_permitted|no_action_taken|service_not_allowed/, "The bank declined it. The client should call their bank or use another card."]
  ];
  const hit = plain.find(([re]) => re.test(code));
  return hit ? hit[1] : md(ch.outcome?.seller_message || ch.failure_message || "Stripe gave no reason.");
}

/** The deal id the app's balance links carry on their payment, if this charge came from one. */
async function linkDealId(ch: StripeCharge): Promise<string | null> {
  if (ch.metadata?.deal_id) return ch.metadata.deal_id;
  if (!ch.payment_intent || !stripeConfigured()) return null;
  try { return (await stripeGet<{ metadata?: Record<string, string> }>(`/payment_intents/${encodeURIComponent(ch.payment_intent)}`)).metadata?.deal_id || null; }
  catch (e) { console.error("payment alert: payment intent", (e as Error).message); return null; }
}

async function chargeEmailName(ch: StripeCharge): Promise<{ email: string | null; name: string | null }> {
  let email = ch.billing_details?.email || ch.receipt_email || null, name = ch.billing_details?.name || null;
  if ((!email || !name) && ch.customer && stripeConfigured()) {
    try {
      const c = await stripeGet<{ deleted?: boolean; email?: string | null; name?: string | null }>(`/customers/${encodeURIComponent(ch.customer)}`);
      if (!c.deleted) { email = email || c.email || null; name = name || c.name || null; }
    } catch { /* the charge's own details are enough */ }
  }
  return { email, name };
}

/** charge.succeeded / charge.failed. Balance-link successes are skipped here: balancePaidAlert posts those, with the exact balance. */
export async function chargeAlert(succeeded: boolean, ch: StripeCharge): Promise<boolean> {
  if (!buzzOn("payments")) return false;
  const msg = await chargeMessage(succeeded, ch);
  return msg ? postToBuzz("payments", msg) : false;
}

/** The message for one charge; null for a balance-link success (balancePaidAlert has it). */
async function chargeMessage(succeeded: boolean, ch: StripeCharge, dealIdKnown?: string | null): Promise<string | null> {
  const dealId = dealIdKnown !== undefined ? dealIdKnown : await linkDealId(ch);
  if (succeeded && dealId) return null;
  const { email, name } = await chargeEmailName(ch);
  const ctx = await contextFor({ dealId, email });
  const who = md(clientName(ctx, name, email));
  const amount = money(ch.amount, ch.currency || "usd");
  const sale = ctx.deal?.amount ? `Sale: ${dollars(num(ctx.deal.amount))}` : "";
  const lines = succeeded
    ? [`💰 **${amount} paid** · ${who}`, ...whereLines(ctx, email), [sale, footer(ctx)].filter(Boolean).join(" · ")]
    : [
        `🛎️ **${amount} payment failed** · ${who}${email && md(email) !== who ? ` · ${md(email)}` : ""}`,
        `Why: ${declineReason(ch)}`,
        ...whereLines(ctx, email),
        /_checkout_cancel+ed/.test(String(ch.outcome?.reason || ch.failure_code || "").toLowerCase())
          ? `Next: ask if they'd like to finish it or pay another way${ctx.deal?.remaining_balance_link ? ` · ${mdLink("Balance link", ctx.deal.remaining_balance_link)}` : ""}`
          : ctx.deal?.remaining_balance_link ? `Next: ask the client to pay again · ${mdLink("Balance link to resend", ctx.deal.remaining_balance_link)}` : "Next: ask the client to try again or use another card",
        footer(ctx)
      ];
  return lines.filter(Boolean).join("\n");
}

/** A balance link paid (checkout.session.completed), after recordPayment added it to the deal. `sale`/`paid` are HubSpot's
 *  figures straight after this payment; without them (deal not found) the message says so instead of guessing. */
export async function balancePaidAlert(o: { dealId: string; amount: number; sale?: number; paid?: number; name?: string | null; email?: string | null }): Promise<boolean> {
  if (!buzzOn("payments")) return false;
  return postToBuzz("payments", await balanceMessage(o));
}

async function balanceMessage(o: { dealId: string; amount: number; sale?: number; paid?: number; name?: string | null; email?: string | null }, ctxIn?: Ctx): Promise<string> {
  const ctx = ctxIn || await contextFor({ dealId: o.dealId });
  const owed = o.sale != null && o.paid != null ? Math.max(0, Math.round((o.sale - o.paid) * 100) / 100) : null;
  const balance = owed == null ? "HubSpot couldn't find this deal, so the payment isn't on it yet"
    : owed < 0.01 ? `✅ **Paid in full** (${dollars(o.sale!)})`
    : `**Still owed: ${dollars(owed)}** of ${dollars(o.sale!)}`;
  const lines = [
    `💰 **${dollars(o.amount)} balance paid** · ${md(clientName(ctx, o.name, o.email))}`,
    ...whereLines(ctx, o.email || null),
    balance,
    footer(ctx)
  ];
  return lines.filter(Boolean).join("\n");
}

/** For /api/buzz/test: the Buzz messages the last `n` real Stripe payments would have made, marked TEST. Balance-link payments
 *  show what's owed as HubSpot has it now (live, they show it straight after that payment). Posts nothing itself. */
export async function replayRecentCharges(n: number): Promise<{ id: string; when: string; message: string }[]> {
  if (!stripeConfigured()) throw new Error("STRIPE_SECRET_KEY isn't set");
  const want = Math.min(Math.max(n, 1), 10);
  const list = await stripeGet<{ data: (StripeCharge & { status: string; created: number })[] }>(`/charges?limit=${want + 5}`); // a few spare: pending ones are skipped
  const out: { id: string; when: string; message: string }[] = [];
  for (const ch of list.data || []) {
    if (out.length >= want) break;
    if (ch.status !== "succeeded" && ch.status !== "failed") continue;
    const succeeded = ch.status === "succeeded";
    const dealId = await linkDealId(ch);
    let message: string | null;
    if (succeeded && dealId) {
      const ctx = await contextFor({ dealId });
      const { email, name } = await chargeEmailName(ch);
      message = await balanceMessage({ dealId, amount: ch.amount / 100, sale: ctx.deal ? num(ctx.deal.amount) : undefined, paid: ctx.deal ? num(ctx.deal.amount_paid) : undefined, name, email }, ctx);
    } else message = await chargeMessage(succeeded, ch, dealId);
    if (!message) continue;
    const when = new Date(ch.created * 1000).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    out.push({ id: ch.id, when, message: `🧪 **TEST**: a replay of a real payment from ${when} ET. Nothing to do.\n${message}` });
  }
  return out;
}
