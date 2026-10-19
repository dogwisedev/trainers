import "server-only";
import crypto from "node:crypto";

// Stripe, without the SDK: remaining-balance payment links, and checking webhook signatures.
// Vercel variables: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_LINKS_FROM (only deals closed on/after this date get links).
export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;

async function stripe<T>(path: string, form: Record<string, string>): Promise<T> {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString()
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Stripe: ${d?.error?.message || r.status}`);
  return d as T;
}

/** A one-time payment link for exactly the remaining balance, tagged with the HubSpot deal id. */
export async function createRemainingLink(o: { dealId: string; amount: number; label: string }): Promise<string> {
  const cents = Math.round(o.amount * 100);
  if (cents < 50) throw new Error("Amount too small for Stripe.");
  const price = await stripe<{ id: string }>("/prices", {
    currency: "usd", unit_amount: String(cents), "product_data[name]": `Remaining balance: ${o.label}`.slice(0, 250), "product_data[metadata][deal_id]": o.dealId
  });
  const link = await stripe<{ url: string }>("/payment_links", {
    "line_items[0][price]": price.id, "line_items[0][quantity]": "1",
    "metadata[deal_id]": o.dealId, "metadata[kind]": "remaining_balance",
    "payment_intent_data[metadata][deal_id]": o.dealId,
    "restrictions[completed_sessions][limit]": "1"
  });
  return link.url;
}

/** Checks the Stripe-Signature header (v1, HMAC-SHA256 of "timestamp.payload"), within 5 minutes. */
export function verifyStripe(payload: string, header: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const want = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return header.split(",").filter((p) => p.startsWith("v1=")).some((p) => {
    const got = p.slice(3);
    return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  });
}
