import { NextResponse } from "next/server";
import { isDemo } from "@/lib/supabase";
import { runFormChecks } from "@/lib/formCheck";
import { runHandoverDrafts } from "@/lib/handoverDraft";
import { runVaccineChecks } from "@/lib/vaccineCheck";

export const maxDuration = 60;
// Every 10 minutes (vercel.json). AI help (migration 055): checks forms that came in, then starts one handover report for a
// dog going home, if there's time left. Its own job, so a slow answer from Claude never holds up reminders or the chat check.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isDemo()) return NextResponse.json({ skipped: "demo" });
  // 60 seconds in all. A handover draft is the long one (up to about 50 s for a big report), so it goes first when one is
  // due; form checks (a few seconds each) fill whatever time is left, and the rest wait for the next run.
  const started = Date.now();
  // Turns: every other run vaccine records go first (two dogs, up to 40 s). They used to run only when the rest had used
  // under 12 seconds, which was almost never, so records sat unread.
  const vaccinesFirst = Math.floor(started / 600000) % 2 === 0;
  let vaccines = vaccinesFirst ? await runVaccineChecks(undefined, 2, started + 40000).catch(() => ({ checked: 0 })) : { checked: 0 };
  const drafts = Date.now() - started < 20000 ? await runHandoverDrafts(undefined, new Date(), 1).catch((e) => ({ drafted: 0, thin: 0, errors: [(e as Error).message] })) : { drafted: 0, thin: 0, errors: [] as string[] };
  const checks = Date.now() - started < 38000 ? await runFormChecks(undefined, 4, started + 42000).catch(() => ({ checked: 0, auto: 0 })) : { checked: 0, auto: 0 };
  if (!vaccinesFirst && Date.now() - started < 25000) vaccines = await runVaccineChecks(undefined, 1, started + 48000).catch(() => ({ checked: 0 }));
  const out = { checks, drafts, vaccines };
  return NextResponse.json(out);
}
