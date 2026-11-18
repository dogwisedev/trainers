import { serviceClient } from "@/lib/supabase";
import { wins } from "@/lib/clientCare";

/** Pulse → Trainers: clients praising the work, by trainer, over the range, with the latest quotes. */
export async function TrainerWins({ from, label }: { from: string; label: string }) {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const all = await wins(`${from}T00:00:00Z`, site, serviceClient(), 500).catch(() => []);
  if (!all.length) return <section className="mt-6"><h2 className="mb-2 text-lead font-extrabold">Wins <span className="text-small font-normal text-ink-soft">{label}</span></h2><p className="panel p-4 text-small text-ink-soft">No client praise picked up in this range yet. Client messages are read for it from now on (migration 060).</p></section>;
  const by = new Map<string, typeof all>();
  for (const w of all) by.set(w.trainer, [...(by.get(w.trainer) || []), w]);
  const rows = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  return (
    <section className="mt-6" aria-label="Wins">
      <h2 className="mb-2 text-lead font-extrabold">Wins <span className="text-small font-normal text-ink-soft">{label}: clients praising the work</span></h2>
      <ul className="panel divide-y divide-line">{rows.map(([t, ws]) => (
        <li key={t} className="px-4 py-3">
          <p className="text-body"><b>{t}</b> · {ws.length} win{ws.length === 1 ? "" : "s"}</p>
          <ul className="mt-1 space-y-1">{ws.slice(0, 3).map((w, i) => <li key={i} className="text-small text-ink-soft"><a href={w.link} className="hover:underline">{w.dog}: {w.quote}</a></li>)}</ul>
        </li>))}</ul>
    </section>
  );
}
