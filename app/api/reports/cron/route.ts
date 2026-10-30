import { NextResponse } from "next/server";
import { isDemo } from "@/lib/supabase";
import { runReportReminders } from "@/lib/reportReminders";
import { trackCron } from "@/lib/cronHealth";
import { checkTripRoutes } from "@/lib/tripRoutes";

export const maxDuration = 60;
// Every 20 minutes (vercel.json). Reminders: only between 8 am and 8 pm Eastern, never the same one twice. Then a few mileage route checks.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isDemo()) return NextResponse.json({ skipped: "demo" });
  const reminders = await trackCron("reports", () => runReportReminders());
  // Mileage check: a few bookings' routes each time (FreeRoute), for the payslips. Never holds up the reminders.
  const routes = await checkTripRoutes({ budgetMs: 25000, limit: 6 }).catch((e) => ({ errors: [(e as Error).message] }));
  return NextResponse.json({ ...reminders, routes });
}
