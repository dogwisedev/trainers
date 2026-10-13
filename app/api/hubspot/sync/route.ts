import { NextResponse } from "next/server";
import { isDemo } from "@/lib/supabase";
import { getViewer } from "@/lib/data";
import { syncHubspotDates } from "@/lib/hubspotSync";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
// Every 30 minutes (vercel.json): booking dates follow the HubSpot deal. Vercel sends the CRON_SECRET automatically.
// An admin signed in to the app can open /api/hubspot/sync in the browser to preview: it always runs as a dry run from there.
// ?mode=dry forces a dry run for the cron caller too.
export async function GET(req: Request) {
  if (isDemo()) return NextResponse.json({ skipped: "demo" });
  const cron = !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron) {
    const v = await getViewer();
    if (v?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = !cron || new URL(req.url).searchParams.get("mode") === "dry";
  const result = await syncHubspotDates(dry ? { mode: "dry" } : {});
  if (result.changed.length || result.errors.length || result.problems.length) console.log("hubspot sync", JSON.stringify(result));
  return NextResponse.json(result);
}
