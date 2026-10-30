import Link from "next/link";
import { requireRole } from "@/lib/data";
import { isDemo } from "@/lib/supabase";
import { DEFAULT_SETTINGS, loadIntro, loadMaterials, loadSettings, pausedByEnv, sendingPaused } from "@/lib/training";
import { SendingSwitch } from "@/components/TrainingAdmin";
import { PLANS, planLabel } from "@/lib/trainingPlan";
import { TrainingAdmin } from "@/components/TrainingAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // importing a folder reads Drive

// Admin → Training materials: for each program (and after drop-off), the videos and PDFs sent in each dog's chat,
// in order, with their messages and the pace. Sent between 12 and 6 PM Eastern, at most one a day.
export default async function Materials({ searchParams }: { searchParams: { plan?: string } }) {
  await requireRole("admin");
  const plan = (PLANS as readonly string[]).includes(searchParams.plan || "") ? searchParams.plan! : PLANS[0];
  if (isDemo()) return <p className="panel p-6 text-ink-soft">Training materials need the database: not available in demo mode.</p>;
  const [all, settings, intro, paused] = await Promise.all([loadMaterials().catch(() => []), loadSettings().catch(() => new Map()), loadIntro().catch(() => ""), sendingPaused().catch(() => false)]);
  const counts = Object.fromEntries(PLANS.map((p) => [p, all.filter((m) => m.plan === p).length]));
  return (
    <>
      <Link prefetch={false} href="/a/trainers" className="text-small font-semibold text-ink-soft underline">Trainers</Link>
      <h1 className="mt-1 text-h1 font-extrabold">Training materials</h1>
      <p className="mb-4 mt-1 text-ink-soft">Short videos and PDFs posted in each dog&apos;s chat, in this order, between 12 and 6 PM Eastern, at most one a day.</p>
      <SendingSwitch paused={paused} byEnv={pausedByEnv()} />
      <TrainingAdmin plan={plan} plans={PLANS.map((p) => ({ value: p, label: `${planLabel(p)} (${counts[p] || 0})` }))}
        items={all.filter((m) => m.plan === plan)} settings={settings.get(plan) || DEFAULT_SETTINGS(plan)} intro={intro} />
    </>
  );
}
