import "server-only";
import { serviceClient, isDemo } from "./supabase";

// Background jobs (Vercel crons) record each run here, so a job that stops running shows up on To do
// instead of failing silently. Stored in app_state as cron:<name> = { at, ok, error }.
export const CRONS = {
  chat: { label: "Chat checks, client invites and emails", everyMin: 10 },
  hubspot: { label: "HubSpot sync (dates, Closed Won, payments)", everyMin: 30 },
  reports: { label: "Form reminders", everyMin: 20 },
  payroll: { label: "Payroll drafts (Mondays)", everyMin: 7 * 24 * 60 }
} as const;
export type CronName = keyof typeof CRONS;
type Rec = { at: string; ok: boolean; error?: string | null };

/** Records one run. Never throws. */
export async function cronRan(name: CronName, ok: boolean, error?: string | null) {
  if (isDemo()) return;
  try {
    await serviceClient().from("app_state").upsert({ key: `cron:${name}`, value: JSON.stringify({ at: new Date().toISOString(), ok, error: error ? error.slice(0, 300) : null }), updated_at: new Date().toISOString() });
  } catch { /* never stop the job */ }
}

/** Runs a cron's work and records how it went (finished = ran; problems inside are kept as the error note). */
export async function trackCron<T>(name: CronName, run: () => Promise<T>): Promise<T> {
  try {
    const r = await run();
    const errs = (r && typeof r === "object" && "errors" in r && Array.isArray((r as { errors: unknown }).errors)) ? (r as { errors: string[] }).errors : [];
    await cronRan(name, true, errs.length ? errs.slice(0, 3).join("; ") : null);
    return r;
  } catch (e) { await cronRan(name, false, (e as Error).message); throw e; }
}

export type CronProblem = { name: CronName; label: string; lastAt: string | null; error: string | null };
/** Jobs that haven't finished a run in 3× their schedule (payroll: 8 days). Nothing recorded yet = only flagged 2 hours after we started watching. */
export async function cronProblems(): Promise<CronProblem[]> {
  if (isDemo()) return [];
  const sb = serviceClient();
  const { data, error } = await sb.from("app_state").select("key, value, updated_at").like("key", "cron:%");
  if (error) return [];
  const rows = new Map(((data || []) as { key: string; value: string | null; updated_at: string }[]).map((r) => [r.key, r]));
  let since = rows.get("cron:watch_since")?.value || null;
  if (!since) { since = new Date().toISOString(); await sb.from("app_state").upsert({ key: "cron:watch_since", value: since, updated_at: since }); }
  const now = Date.now(), out: CronProblem[] = [];
  for (const [name, c] of Object.entries(CRONS) as [CronName, (typeof CRONS)[CronName]][]) {
    let rec: Rec | null = null;
    try { rec = JSON.parse(rows.get(`cron:${name}`)?.value || "null"); } catch { rec = null; }
    const limit = name === "payroll" ? 8 * 86400e3 : c.everyMin * 3 * 60e3;
    if (!rec) { if (name !== "payroll" && now - Date.parse(since) > 2 * 3600e3) out.push({ name, label: c.label, lastAt: null, error: null }); continue; }
    if (!rec.ok || now - Date.parse(rec.at) > limit) out.push({ name, label: c.label, lastAt: rec.at, error: rec.ok ? null : rec.error || null });
  }
  return out;
}
