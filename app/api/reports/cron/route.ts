import { NextResponse } from "next/server";
import { isDemo } from "@/lib/supabase";
import { runReportReminders } from "@/lib/reportReminders";

export const maxDuration = 60;
// Every 20 minutes (vercel.json). Only acts between 8 am and 8 pm Eastern, and never sends the same reminder twice.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isDemo()) return NextResponse.json({ skipped: "demo" });
  return NextResponse.json(await runReportReminders());
}
