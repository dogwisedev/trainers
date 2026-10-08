import { NextResponse } from "next/server";
import { isDemo, serviceClient } from "@/lib/supabase";
import { weekUsage } from "@/lib/capacity";
import { addDays, short, weekStart, weeksFrom } from "@/lib/dates";
import { Booking, TimeOff, Trainer } from "@/lib/types";

// Book a Closed Won HubSpot deal into a trainer's calendar (used by the Sales extension).
// POST /api/bookings   header x-api-key: BOOKING_KEY
// { trainer_id, client_name, dog_name, program, weeks, start_date, notes, hubspot_deal_id, force }
//  201 { booking, trainer, url }
//  409 { code: "already_booked" | "full", message, ... }   force: true books anyway when "full"

const bad = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

export async function POST(req: Request) {
  if (!process.env.BOOKING_KEY || req.headers.get("x-api-key") !== process.env.BOOKING_KEY) return bad(401, { message: "Booking key is wrong or missing." });
  if (isDemo()) return bad(403, { message: "The app is in demo mode: connect Supabase first." });

  const b = await req.json().catch(() => ({}));
  const trainerId = String(b.trainer_id || ""), client = String(b.client_name || "").trim();
  const weeks = Math.round(Number(b.weeks) || 0), start = String(b.start_date || "");
  const dealId = b.hubspot_deal_id ? String(b.hubspot_deal_id) : null;
  if (!trainerId || !client || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return bad(400, { message: "Trainer, client name and start date are required." });
  if (weeks < 1 || weeks > 12) return bad(400, { message: "Program length must be 1 to 12 weeks." });

  const sb = serviceClient();
  const { data: t } = await sb.from("trainers").select("*").eq("id", trainerId).maybeSingle();
  if (!t || !t.active) return bad(404, { message: "That trainer isn't active in the app." });
  const trainer = t as Trainer;

  // One live booking per HubSpot deal
  if (dealId) {
    const { data: existing } = await sb.from("bookings").select("id, trainer_id, start_date, end_date, dog_name, trainers(name)")
      .eq("hubspot_deal_id", dealId).neq("status", "cancelled").limit(1);
    const e = existing?.[0] as unknown as { trainer_id: string; start_date: string; end_date: string; trainers?: { name: string } } | undefined;
    if (e) return bad(409, {
      code: "already_booked",
      message: `This deal is already booked with ${e.trainers?.name || "a trainer"}, ${short(e.start_date)} to ${short(e.end_date)}. Change it in the app.`,
      url: `${process.env.NEXT_PUBLIC_SITE_URL || ""}/a/trainers/${e.trainer_id}`
    });
  }

  const s = weekStart(start), end = addDays(s, weeks * 7 - 1);

  // Room every week?
  if (!b.force) {
    const [bk, off] = await Promise.all([
      sb.from("bookings").select("*").eq("trainer_id", trainerId).neq("status", "cancelled").lte("start_date", end).gte("end_date", s),
      sb.from("time_off").select("*").eq("trainer_id", trainerId).lte("start_date", end).gte("end_date", s)
    ]);
    const use = weekUsage(trainer, (bk.data || []) as Booking[], (off.data || []) as TimeOff[], weeksFrom(s, weeks));
    const fullWeek = use.find((w) => w.free < 1);
    if (fullWeek) return bad(409, {
      code: "full",
      message: `${trainer.name.split(" ")[0]} has no free kennel the week of ${short(fullWeek.week)}${fullWeek.blocked >= fullWeek.cap ? " (time off)" : ""}.`,
      week: fullWeek.week
    });
  }

  const { data: booking, error } = await sb.from("bookings").insert({
    trainer_id: trainerId, client_name: client.slice(0, 120), dog_name: String(b.dog_name || "").trim().slice(0, 80) || null,
    program: String(b.program || "").trim().slice(0, 120) || `${weeks}-week`, start_date: s, end_date: end, weeks,
    status: "confirmed", notes: String(b.notes || "").trim().slice(0, 2000) || null, hubspot_deal_id: dealId, source: "sales-extension"
  }).select("*").single();
  if (error) return bad(500, { message: error.message });

  return NextResponse.json({
    booking, trainer: { id: trainer.id, name: trainer.name },
    url: `${process.env.NEXT_PUBLIC_SITE_URL || ""}/a/trainers/${trainer.id}`
  }, { status: 201 });
}
