import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient } from "@/lib/supabase";
import { demoId, ensureReport } from "@/lib/reportData";
import { Kind } from "@/lib/reports";
import { Booking } from "@/lib/types";

// Opens (or starts) the report for a booking. Trainers can only start their own (row level security).
export async function GET(req: NextRequest) {
  const u = req.nextUrl, bookingId = u.searchParams.get("booking") || "", kind = (u.searchParams.get("kind") === "handover" ? "handover" : "weekly") as Kind, week = Number(u.searchParams.get("week")) || 0;
  const v = await getViewer();
  if (!v || v.role !== "trainer") return NextResponse.redirect(new URL("/login", req.url));
  if (isDemo()) return NextResponse.redirect(new URL(`/t/reports/${encodeURIComponent(demoId(bookingId, kind, week))}`, req.url));
  const sb = serverClient();
  const { data: b } = await sb.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  if (!b) return NextResponse.redirect(new URL("/t", req.url));
  try { return NextResponse.redirect(new URL(`/t/reports/${await ensureReport(sb, b as Booking, v.name, kind, week, false)}`, req.url)); }
  catch { return NextResponse.redirect(new URL("/t", req.url)); }
}
