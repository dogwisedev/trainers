import { NextResponse } from "next/server";
import { isDemo } from "@/lib/supabase";
import { getViewer } from "@/lib/data";
import { syncHubspotDates } from "@/lib/hubspotSync";
import { syncPretraining } from "@/lib/pretraining";
import { checkUnbookedDeals } from "@/lib/unbookedDeals";
import { writeFormLinks } from "@/lib/clientForms";
import { cronRan } from "@/lib/cronHealth";

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
  // Before-training checklist: read the client's answers, retry saves HubSpot missed, "Not ready" incidents a week out (not on a dry preview)
  const pretraining = dry ? null : await syncPretraining().catch((e) => ({ errors: [(e as Error).message] }));
  if (pretraining?.errors?.length) console.log("pretraining sync", JSON.stringify(pretraining));
  // Sales and payments now have their own job (/api/sales/sync, and "Refresh from HubSpot" on the Sales page)
  // Closed Won deals (since Oct 11) with no booking in the app: a To do item each, cleared once booked
  const unbooked = dry ? null : await checkUnbookedDeals().catch((e) => ({ errors: [(e as Error).message] }));
  // Each new HubSpot contact gets its personal before-training link (dogwise_forms_link)
  const formLinks = dry ? null : await writeFormLinks().catch((e) => ({ written: 0, errors: [(e as Error).message] }));
  if (cron) await cronRan("hubspot", !result.errors.length, [...result.errors, ...(unbooked?.errors || [])].slice(0, 3).join("; ") || null);
  return NextResponse.json({ ...result, pretraining, unbooked, formLinks });
}
