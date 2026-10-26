import { NextResponse } from "next/server";
import { isDemo } from "@/lib/supabase";
import { runChatChecks } from "@/lib/chatOps";
import { trackCron } from "@/lib/cronHealth";

export const maxDuration = 60;
// Every 10 minutes (vercel.json): opens and clears chat incidents, alerts admins, sends the rare client digest.
// Vercel sends the CRON_SECRET automatically.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isDemo()) return NextResponse.json({ skipped: "demo" });
  return NextResponse.json(await trackCron("chat", () => runChatChecks()));
}
