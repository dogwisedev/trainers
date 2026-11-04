import { NextResponse } from "next/server";
import { isDemo } from "@/lib/supabase";
import { readDealForBooking } from "@/lib/dealRead";
import { createAsk, lanesForDeal } from "@/lib/laneData";
import { cleanDealId } from "@/lib/dealId";

export const maxDuration = 30;
// Sales Assistant: "Ask the POC" (kind offer: the POC checks with the trainer) or "Ask Pedro" (probation, out of range).
// POST /api/asks   header x-api-key: BOOKING_KEY   { kind: "offer" | "pedro", deal, trainer_id, note?, by? }
export async function POST(req: Request) {
  if (!process.env.BOOKING_KEY || req.headers.get("x-api-key") !== process.env.BOOKING_KEY) return NextResponse.json({ ok: false, message: "Booking key is wrong or missing." }, { status: 401 });
  if (isDemo()) return NextResponse.json({ ok: false, message: "Demo mode." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const kind = b.kind === "pedro" ? "pedro" : "offer", id = cleanDealId(String(b.deal || "")), trainerId = String(b.trainer_id || "");
  if (!id || !/^\d+$/.test(id) || !trainerId) return NextResponse.json({ ok: false, message: "Deal and trainer are needed." }, { status: 400 });
  const d = await readDealForBooking(id);
  if (!d.ok || !d.deal) return NextResponse.json({ ok: false, message: d.message }, { status: 404 });
  const ctx = { dealId: id, zip: d.deal.zip, start: d.deal.start, end: d.deal.end, program: d.deal.program, dogs: Math.max(1, d.deal.dogs.length), dogNames: d.deal.dogs, client: d.deal.client, soldOn: d.deal.soldOn };
  const lanes = await lanesForDeal(ctx, { limit: 9 });
  const row = lanes.ok ? lanes.rows.find((r) => r.id === trainerId) : null;
  const r = await createAsk({ kind, dealId: id, trainerId, ctx, reasons: row?.reasons || [], hours: row?.hours ?? (kind === "offer" ? 24 : null), note: String(b.note || "").slice(0, 500), by: `${String(b.by || "").trim() || "Sales"} (Sales Assistant)` });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
