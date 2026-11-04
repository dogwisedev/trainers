import { NextResponse, type NextRequest } from "next/server";
import { isDemo } from "@/lib/supabase";
import { readDealForBooking } from "@/lib/dealRead";
import { lanesForDeal } from "@/lib/laneData";
import { cleanDealId } from "@/lib/dealId";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
// Sales Assistant: the closest trainers for a Closed Won deal, each in its Assign-or-Ask lane (as the app's Book now picker).
// GET /api/lanes?deal=123   header x-api-key: BOOKING_KEY   (&zip=12345 overrides the deal's ZIP)
export async function GET(req: NextRequest) {
  if (!process.env.BOOKING_KEY || req.headers.get("x-api-key") !== process.env.BOOKING_KEY) return NextResponse.json({ ok: false, message: "Booking key is wrong or missing." }, { status: 401 });
  if (isDemo()) return NextResponse.json({ ok: false, message: "Demo mode." }, { status: 403 });
  const id = cleanDealId(req.nextUrl.searchParams.get("deal") || "");
  if (!id || !/^\d+$/.test(id)) return NextResponse.json({ ok: false, message: "Which deal?" }, { status: 400 });
  const d = await readDealForBooking(id);
  if (!d.ok || !d.deal) return NextResponse.json({ ok: false, message: d.message }, { status: 404 });
  const zip = /^\d{5}$/.test(req.nextUrl.searchParams.get("zip") || "") ? req.nextUrl.searchParams.get("zip")! : d.deal.zip;
  const r = await lanesForDeal({ dealId: id, zip, start: d.deal.start, end: d.deal.end, program: d.deal.program, dogs: Math.max(1, d.deal.dogs.length), dogNames: d.deal.dogs, client: d.deal.client, soldOn: d.deal.soldOn });
  return NextResponse.json(r.ok ? { ok: true, deal: { id, start: d.deal.start, end: d.deal.end, program: d.deal.program, dogs: d.deal.dogs, zip }, place: r.place, trainers: r.rows } : r, { headers: { "Cache-Control": "no-store" } });
}
