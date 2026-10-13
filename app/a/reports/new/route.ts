import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient } from "@/lib/supabase";
import { ensureReport } from "@/lib/reportData";
import { Kind } from "@/lib/reports";
import { Booking } from "@/lib/types";

// Admin starts a report on a trainer's behalf (for example when one is badly overdue).
export async function GET(req: NextRequest) {
  const u = req.nextUrl, bookingId = u.searchParams.get("booking") || "", kind = (["intake", "weekly", "handover"].includes(u.searchParams.get("kind") || "") ? u.searchParams.get("kind") : "weekly") as Kind, week = Number(u.searchParams.get("week")) || 0;
  const v = await getViewer();
  if (!v || v.role !== "admin" || isDemo()) return NextResponse.redirect(new URL("/a/reports", req.url));
  const sb = serverClient();
  const { data: b } = await sb.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  const { data: t } = b ? await sb.from("trainers").select("name").eq("id", b.trainer_id).maybeSingle() : { data: null };
  if (!b || !t) return NextResponse.redirect(new URL("/a/reports", req.url));
  try { return NextResponse.redirect(new URL(`/a/reports/${await ensureReport(sb, b as Booking, t.name, kind, week, true)}`, req.url)); }
  catch { return NextResponse.redirect(new URL("/a/reports", req.url)); }
}
