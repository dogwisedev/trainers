import { NextResponse } from "next/server";
import seed from "@/lib/demo-seed.json";
import { isDemo, serviceClient } from "@/lib/supabase";
import { soonestOpening, weekUsage } from "@/lib/capacity";
import { addDays, todayIso, weeksFrom } from "@/lib/dates";
import { Booking, TimeOff, Trainer } from "@/lib/types";

// Live trainer list + availability for the Sales extension, Bark Buster and the sales assistant.
//   GET /api/availability                     every active trainer
//   GET /api/availability?zip=75039           + distance from that ZIP, nearest that can take a dog first
//   GET /api/availability?lat=32.8&lon=-97.1  same, from coordinates
//   &limit=10                                 cap the list
// Header: x-api-key: AVAILABILITY_KEY

const haversine = (a: number, b: number, c: number, d: number) => {
  const R = 3958.8, r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

async function geocodeZip(zip: string) {
  try {
    const r = await fetch(`https://api.zippopotam.us/us/${zip}`, { next: { revalidate: 60 * 60 * 24 * 30 } });
    if (!r.ok) return null;
    const p = (await r.json()).places?.[0];
    return p ? { lat: +p.latitude, lon: +p.longitude, city: p["place name"] as string, state: p["state abbreviation"] as string } : null;
  } catch { return null; }
}

export async function GET(req: Request) {
  if (!process.env.AVAILABILITY_KEY || req.headers.get("x-api-key") !== process.env.AVAILABILITY_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = new URL(req.url).searchParams;
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
    if (t.error) return NextResponse.json({ error: t.error.message }, { status: 500 });
    trainers = (t.data || []) as Trainer[]; bookings = (b.data || []) as Booking[]; off = (o.data || []) as TimeOff[];
  }

  // Where is the lead?
  let origin: { lat: number; lon: number; city?: string; state?: string; zip?: string } | null = null;
  const zip = (q.get("zip") || "").trim();
  if (/^\d{5}$/.test(zip)) {
    const g = await geocodeZip(zip);
    if (!g) return NextResponse.json({ error: `ZIP ${zip} not found` }, { status: 404 });
    origin = { ...g, zip };
  } else if (q.get("lat") && q.get("lon")) {
    origin = { lat: +q.get("lat")!, lon: +q.get("lon")! };
  }

  const weeks = weeksFrom(today, 16);
  let list = trainers.map((t) => {
    const use = weekUsage(t, bookings, off, weeks);
    const distance = origin && t.lat != null && t.lon != null ? Math.round(haversine(origin.lat, origin.lon, t.lat, t.lon)) : null;
    const freeNext8 = use.slice(0, 8).reduce((n, w) => n + w.free, 0);
    return {
      id: t.id, name: t.name, city: t.city, state: t.state, zip: t.zip, lat: t.lat, lon: t.lon,
      range: t.range_miles, range_text: t.range_text, capacity: t.capacity,
      programs: t.programs, offering: t.offering, notes: t.notes,
      distance, inRange: distance == null ? null : distance <= t.range_miles,
      awayNow: use[0].cap > 0 && use[0].blocked >= use[0].cap,
      freeNow: use[0].free, free: use.map((w) => w.free),
      freeNext4: use.slice(0, 4).reduce((n, w) => n + w.free, 0), freeNext8,
      available: freeNext8 > 0,
      soon2: soonestOpening(use, 2), soon3: soonestOpening(use, 3), soon4: soonestOpening(use, 4)
    };
  });

  if (origin) {
    // Covers the lead and has room first (closest first), then covers but full, then out of range by how far over.
    list.sort((a, b) => {
      const rank = (x: typeof a) => (x.distance == null ? 3 : x.inRange ? (x.available ? 0 : 1) : 2);
      return rank(a) - rank(b) || (rank(a) === 2 ? a.distance! / a.range - b.distance! / b.range : (a.distance ?? 1e9) - (b.distance ?? 1e9));
    });
  } else {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  const limit = Number(q.get("limit")) || 0;
  if (limit > 0) list = list.slice(0, limit);

  return NextResponse.json({ generated: new Date().toISOString(), origin, weeks, trainers: list }, { headers: { "Cache-Control": "private, max-age=60" } });
}
