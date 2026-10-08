import { NextResponse } from "next/server";
import seed from "@/lib/demo-seed.json";
import { isDemo, serviceClient } from "@/lib/supabase";
import { soonestOpening, weekUsage } from "@/lib/capacity";
import { addDays, todayIso, weeksFrom } from "@/lib/dates";
import { Booking, TimeOff, Trainer } from "@/lib/types";

// Live trainer availability for Bark Buster and the sales assistant.
// GET /api/availability  with header  x-api-key: AVAILABILITY_KEY
export async function GET(req: Request) {
  if (!process.env.AVAILABILITY_KEY || req.headers.get("x-api-key") !== process.env.AVAILABILITY_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const today = todayIso();
  let trainers: Trainer[], bookings: Booking[], off: TimeOff[];
  if (isDemo()) {
    const s = seed as unknown as { trainers: Trainer[]; bookings: Booking[]; time_off: TimeOff[] };
    trainers = s.trainers.filter((t) => t.active); bookings = s.bookings; off = s.time_off;
  } else {
    const sb = serviceClient();
    const [t, b, o] = await Promise.all([
      sb.from("trainers").select("*").eq("active", true),
      sb.from("bookings").select("*").gte("end_date", addDays(today, -7)).neq("status", "cancelled"),
      sb.from("time_off").select("*").gte("end_date", addDays(today, -7))
    ]);
    trainers = (t.data || []) as Trainer[]; bookings = (b.data || []) as Booking[]; off = (o.data || []) as TimeOff[];
  }
  const weeks = weeksFrom(today, 16);
  return NextResponse.json({
    generated: new Date().toISOString(),
    weeks,
    trainers: trainers.map((t) => {
      const use = weekUsage(t, bookings, off, weeks);
      return {
        id: t.id, name: t.name, city: t.city, state: t.state, zip: t.zip, lat: t.lat, lon: t.lon, range: t.range_miles, capacity: t.capacity,
        programs: t.programs, free: use.map((w) => w.free), freeNext4: use.slice(0, 4).reduce((n, w) => n + w.free, 0),
        freeNext8: use.slice(0, 8).reduce((n, w) => n + w.free, 0), soon2: soonestOpening(use, 2), soon3: soonestOpening(use, 3)
      };
    })
  }, { headers: { "Cache-Control": "private, max-age=60" } });
}
