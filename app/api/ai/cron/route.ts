import { NextResponse } from "next/server";
import { isDemo } from "@/lib/supabase";
import { runFormChecks } from "@/lib/formCheck";
import { runHandoverDrafts } from "@/lib/handoverDraft";

export const maxDuration = 60;
// Every 10 minutes (vercel.json). AI help (migration 055): checks forms that came in, then starts one handover report for a
// dog going home, if there's time left. Its own job, so a slow answer from Claude never holds up reminders or the chat check.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isDemo()) return NextResponse.json({ skipped: "demo" });
  const started = Date.now();
  const checks = await runFormChecks(undefined, 3).catch(() => ({ checked: 0, auto: 0 }));
  const drafts = Date.now() - started < 12000 ? await runHandoverDrafts(undefined, new Date(), 1).catch((e) => ({ drafted: 0, thin: 0, errors: [(e as Error).message] })) : { drafted: 0, thin: 0, errors: [] as string[] };
  const out = { checks, drafts };
  return NextResponse.json(out);
}
