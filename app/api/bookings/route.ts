import { NextResponse } from "next/server";
import { isDemo, serviceClient } from "@/lib/supabase";
import { weekUsage } from "@/lib/capacity";
import { addDays, daysBetween, dropOff, short, weekStart, weeksFrom } from "@/lib/dates";
import { Booking, TimeOff, Trainer } from "@/lib/types";
import { notifyBookings } from "@/lib/bookingEmail";
import { ensureChatsForBookings } from "@/lib/chat";
import { datesFromHubspot } from "@/lib/hubspot";
import { syncHubspotDates } from "@/lib/hubspotSync";

// Book a Closed Won HubSpot deal into a trainer's calendar (used by the Sales extension).
// POST /api/bookings   header x-api-key: BOOKING_KEY
// { trainer_id, client_name, client_email, hubspot_deal_id, notes, force,
//   dogs: [{ dog_name, program, weeks, start_date, end_date?, notes }] }      one booking (kennel) per dog
// Dates are used exactly as given (no rounding to Sunday). No end_date = start + weeks + extra days. Then the HubSpot deal's dates take over.
// (Old single-dog shape { dog_name, program, weeks, start_date } still works.)
//  201 { bookings, booking, trainer, url }
//  409 { code: "already_booked" | "full", message, ... }   force: true books anyway when "full"

export const maxDuration = 60; // saves, reads HubSpot, emails the trainer and makes the chat
const bad = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

export async function POST(req: Request) {
  if (!process.env.BOOKING_KEY || req.headers.get("x-api-key") !== process.env.BOOKING_KEY) return bad(401, { message: "Booking key is wrong or missing." });
  if (isDemo()) return bad(403, { message: "The app is in demo mode: connect Supabase first." });

  const b = await req.json().catch(() => ({}));
  const trainerId = String(b.trainer_id || ""), client = String(b.client_name || "").trim();
  const clientEmail = /^\S+@\S+\.\S+$/.test(String(b.client_email || "").trim()) ? String(b.client_email).trim().toLowerCase().slice(0, 200) : null;
  const dealId = b.hubspot_deal_id ? String(b.hubspot_deal_id) : null;
  const rawDogs: Record<string, unknown>[] = Array.isArray(b.dogs) && b.dogs.length
    ? b.dogs
    : [{ dog_name: b.dog_name, program: b.program, weeks: b.weeks, start_date: b.start_date, notes: b.notes }];
  if (!trainerId || !client) return bad(400, { message: "Trainer and client name are required." });
  if (rawDogs.length > 6) return bad(400, { message: "Book at most 6 dogs at once." });
  const dogs = rawDogs.map((d, i) => ({
    i, name: String(d.dog_name || "").trim().slice(0, 80), program: String(d.program || "").trim().slice(0, 120),
    weeks: Math.round(Number(d.weeks) || 0), start: String(d.start_date || ""), end: String(d.end_date || ""), notes: String(d.notes || "").trim().slice(0, 2000), rehab: d.rehab === true,
    extra: Math.min(13, Math.max(0, Math.round(Number(d.extra_days) || 0)))
  }));
  for (const d of dogs) {
    const label = d.name || `Dog ${d.i + 1}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.start)) return bad(400, { message: `${label}: pick a start date.` });
    if (d.weeks < 1 || d.weeks > 12) return bad(400, { message: `${label}: program length must be 1 to 12 weeks.` });
    if (d.end && (!/^\d{4}-\d{2}-\d{2}$/.test(d.end) || d.end < d.start)) return bad(400, { message: `${label}: the end date must be on or after the start date.` });
    if (d.end && daysBetween(d.start, d.end) - d.weeks * 7 > 13) return bad(400, { message: `${label}: the dates are more than 13 days longer than a ${d.weeks}-week program. Check the program length.` });
  }

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

  // Rows to insert, one per dog
  const rows = dogs.map((d) => {
    const s = d.start;
    const end = d.end || dropOff(s, d.weeks, d.extra);                       // end_date = the drop-off day
    const extra = d.end ? Math.max(0, daysBetween(s, d.end) - d.weeks * 7) : d.extra;
    return {
      trainer_id: trainerId, client_name: client.slice(0, 120), dog_name: d.name || null, ...(clientEmail ? { client_email: clientEmail } : {}),
      program: d.program || `${d.weeks}-week`, start_date: s, end_date: end, weeks: d.weeks, extra_days: extra,
      status: "confirmed", notes: [d.notes, String(b.notes || "").trim()].filter(Boolean).join("\n").slice(0, 2000) || null,
      hubspot_deal_id: dealId, source: "sales-extension", rehab: !!d.rehab || /rehab|\bRR\b/i.test(d.program)
    };
  });

  // Room every week, counting the dogs in this same request too
  if (!b.force) {
    const from = rows.reduce((m, r) => (r.start_date < m ? r.start_date : m), rows[0].start_date);
    const to = rows.reduce((m, r) => (r.end_date > m ? r.end_date : m), rows[0].end_date);
    const [bk, off] = await Promise.all([
      sb.from("bookings").select("*").eq("trainer_id", trainerId).neq("status", "cancelled").lte("start_date", to).gte("end_date", from),
      sb.from("time_off").select("*").eq("trainer_id", trainerId).lte("start_date", to).gte("end_date", from)
    ]);
    const taken = [...((bk.data || []) as Booking[])];
    for (const [k, r] of rows.entries()) {
      const use = weekUsage(trainer, taken, (off.data || []) as TimeOff[], weeksFrom(r.start_date, Math.ceil((daysBetween(weekStart(r.start_date), r.end_date) + 1) / 7)));
      const fullWeek = use.find((w) => w.free < 1);
      if (fullWeek) return bad(409, {
        code: "full",
        message: `${trainer.name.split(" ")[0]} has no free kennel for ${r.dog_name || `dog ${k + 1}`} the week of ${short(fullWeek.week)}${fullWeek.blocked >= fullWeek.cap ? " (time off)" : ""}.`,
        week: fullWeek.week, dog: k
      });
      taken.push({ ...(r as unknown as Booking), id: `new-${k}` });
    }
  }

  const { data: inserted, error } = await sb.from("bookings").insert(rows).select("*");
  if (error) return bad(500, { message: error.message });
  let created = inserted;
  // HubSpot is the source of truth for dates: take the deal's real dates now, before the trainer is emailed
  if (dealId && datesFromHubspot()) {
    await syncHubspotDates({ mode: "quiet", dealIds: [dealId], sb }).catch(() => null);
    created = (await sb.from("bookings").select("*").in("id", (inserted || []).map((c: { id: string }) => c.id))).data || inserted;
  }
  const emailed = await notifyBookings(sb, (created || []).map((c: { id: string }) => c.id), "new");
  // One chat per deal. Never blocks the booking; clients are only emailed their link when CHAT_INVITE_CLIENTS=1.
  const chats = await ensureChatsForBookings(created || [], { invite: process.env.CHAT_INVITE_CLIENTS === "1" }).catch(() => []);

  return NextResponse.json({
    bookings: created, booking: created?.[0], trainer: { id: trainer.id, name: trainer.name }, emailed, chats,
    url: `${process.env.NEXT_PUBLIC_SITE_URL || ""}/a/trainers/${trainer.id}`
  }, { status: 201 });
}
