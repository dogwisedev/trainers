import { NextResponse } from "next/server";
import { verifyStripe } from "@/lib/stripe";
import { recordPayment } from "@/lib/money";

export const dynamic = "force-dynamic";
// Stripe → app: a remaining-balance link was paid. Adds it to the deal's amount_paid in HubSpot, and marks the deal Paid when nothing is owed.
// In Stripe: Developers → Webhooks → add https://<app>/api/stripe/webhook, event checkout.session.completed.
export async function POST(req: Request) {
  const payload = await req.text();
  if (!verifyStripe(payload, req.headers.get("stripe-signature"))) return NextResponse.json({ error: "bad signature" }, { status: 400 });
  const ev = JSON.parse(payload) as { type: string; data: { object: { id: string; metadata?: Record<string, string>; amount_total?: number; payment_status?: string } } };
  if (ev.type !== "checkout.session.completed") return NextResponse.json({ ignored: ev.type });
  const s = ev.data.object, dealId = s.metadata?.deal_id;
  if (!dealId || s.payment_status !== "paid") return NextResponse.json({ ignored: "not a paid deal payment" });
  try { return NextResponse.json(await recordPayment(dealId, (s.amount_total || 0) / 100, s.id)); }
  catch (e) { console.error("stripe webhook", (e as Error).message); return NextResponse.json({ error: (e as Error).message }, { status: 500 }); } // Stripe retries
}
