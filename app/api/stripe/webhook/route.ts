import { NextResponse } from "next/server";
import { verifyStripe } from "@/lib/stripe";
import { recordPayment } from "@/lib/money";
import { balancePaidAlert, chargeAlert, type StripeCharge } from "@/lib/paymentAlert";

export const dynamic = "force-dynamic";
// Stripe → app:
//  checkout.session.completed  a remaining-balance link was paid. Adds it to the deal's amount_paid in HubSpot, and marks the
//                              deal Paid when nothing is owed. Then tells the Buzz payments channel, with the exact balance.
//  charge.succeeded / failed   only for the Buzz payments channel (Slack's alert still comes from barktoHubSpot). Always
//                              answers 200, so a Buzz or HubSpot hiccup never makes Stripe retry a payment event.
// In Stripe: Developers → Webhooks → https://<app>/api/stripe/webhook, events checkout.session.completed, charge.succeeded, charge.failed.
export async function POST(req: Request) {
  const payload = await req.text();
  if (!verifyStripe(payload, req.headers.get("stripe-signature"))) return NextResponse.json({ error: "bad signature" }, { status: 400 });
  const ev = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };

  if (ev.type === "charge.succeeded" || ev.type === "charge.failed") {
    try { await chargeAlert(ev.type === "charge.succeeded", ev.data.object as unknown as StripeCharge); }
    catch (e) { console.error("stripe webhook: payment alert", (e as Error).message); }
    return NextResponse.json({ ok: true });
  }

  if (ev.type !== "checkout.session.completed") return NextResponse.json({ ignored: ev.type });
  const s = ev.data.object as { id: string; metadata?: Record<string, string>; amount_total?: number; payment_status?: string; customer_details?: { name?: string | null; email?: string | null } | null };
  const dealId = s.metadata?.deal_id;
  if (!dealId || s.payment_status !== "paid") return NextResponse.json({ ignored: "not a paid deal payment" });
  const amount = (s.amount_total || 0) / 100;
  try {
    const res = await recordPayment(dealId, amount, s.id);
    // Once per payment: "already counted" is a Stripe retry of one that was already announced
    if (res.fresh || !res.ok) {
      await balancePaidAlert({ dealId, amount, sale: res.sale, paid: res.paid, name: s.customer_details?.name, email: s.customer_details?.email })
        .catch((e) => console.error("stripe webhook: balance alert", (e as Error).message));
    }
    return NextResponse.json(res);
  }
  catch (e) { console.error("stripe webhook", (e as Error).message); return NextResponse.json({ error: (e as Error).message }, { status: 500 }); } // Stripe retries
}
