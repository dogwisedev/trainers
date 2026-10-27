import { NextResponse } from "next/server";
import { availability } from "@/lib/availability";

// Live trainer list + availability for the Sales extension, Bark Buster and the sales assistant.
//   GET /api/availability                     every active trainer
//   GET /api/availability?zip=75039           + distance from that ZIP, nearest that can take a dog first
//   GET /api/availability?lat=32.8&lon=-97.1  same, from coordinates
//   &limit=10                                 cap the list
// Header: x-api-key: AVAILABILITY_KEY
// The work is in lib/availability.ts (Claude uses it too).

export async function GET(req: Request) {
  if (!process.env.AVAILABILITY_KEY || req.headers.get("x-api-key") !== process.env.AVAILABILITY_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = new URL(req.url).searchParams;
  const r = await availability({ zip: q.get("zip") || "", lat: q.get("lat"), lon: q.get("lon"), limit: Number(q.get("limit")) || 0 });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ generated: r.generated, origin: r.origin, weeks: r.weeks, trainers: r.trainers }, { headers: { "Cache-Control": "private, max-age=60" } });
}
