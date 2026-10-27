import { NextResponse } from "next/server";
import { isDemo } from "@/lib/supabase";
import { runSalesSync } from "@/lib/salesSync";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
// Every 30 minutes (vercel.json): every Closed Won deal and every booked deal's money, from HubSpot. Vercel sends the CRON_SECRET.
export async function GET(req: Request) {
  if (isDemo()) return NextResponse.json({ skipped: "demo" });
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await runSalesSync("schedule"));
}
