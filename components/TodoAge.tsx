import Link from "next/link";
import { buildTodo } from "@/lib/todo";

/** Pulse → Office: how long To do items have been waiting on the office, and on whom. Right now, not the range. */
export async function TodoAge() {
  const d = await buildTodo().catch(() => null);
  if (!d) return null;
  const items = d.items.filter((i) => i.since);
  const age = (iso: string) => (Date.now() - new Date(iso).getTime()) / 864e5;
  const over = (days: number) => items.filter((i) => age(i.since!) >= days);
  const owners = new Map<string, { n: number; old: number; oldest: number }>();
  for (const i of items) { const k = i.poc || "No owner", o = owners.get(k) || { n: 0, old: 0, oldest: 0 }; o.n++; if (age(i.since!) >= 2) o.old++; o.oldest = Math.max(o.oldest, age(i.since!)); owners.set(k, o); }
  const rows = [...owners.entries()].sort((a, b) => b[1].old - a[1].old || b[1].n - a[1].n);
  return (
    <section className="mt-6" aria-label="To do waiting on the office">
      <h2 className="mb-2 text-lead font-extrabold">To do, waiting on the office <span className="text-small font-normal text-ink-soft">right now</span></h2>
      <div className="panel p-4">
        <p className="text-body"><b>{items.length}</b> items open · <b className={over(2).length ? "text-heart" : ""}>{over(2).length}</b> waited 2+ days · <b className={over(7).length ? "text-heart" : ""}>{over(7).length}</b> waited a week or more. <Link prefetch={false} href="/a" className="font-semibold underline">Open To do</Link></p>
        <ul className="mt-3 divide-y divide-line">{rows.map(([who, o]) => (
          <li key={who} className="flex items-center gap-3 py-2 text-body"><span className="w-28 shrink-0 font-bold">{who}</span><span className="flex-1 text-ink-soft">{o.n} open, <span className={o.old ? "font-semibold text-heart" : ""}>{o.old} for 2+ days</span>, oldest {Math.floor(o.oldest)} day{Math.floor(o.oldest) === 1 ? "" : "s"}</span></li>))}</ul>
        <p className="mt-2 text-caption text-ink-faint">Owner = the trainer&apos;s Point of Contact on the item; decisions are Sean&apos;s. A fair share won&apos;t clear on the day (waiting on a trainer or a client); the ones a week old are the ones to look at.</p>
      </div>
    </section>
  );
}
