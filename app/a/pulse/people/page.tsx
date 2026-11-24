import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getViewer } from "@/lib/data";
import { addDays, todayIso } from "@/lib/dates";
import { canSeePeople, peopleReport } from "@/lib/work";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** How each office person works: when (weekday by hour, US Eastern), in what rhythm, on what. Only for the emails in
 *  PEOPLE_INSIGHTS_EMAILS (alma@ by default): everyone else gets "not found", and there's no link to it in the menus. */
export default async function People({ searchParams }: { searchParams: { d?: string } }) {
  const v = await getViewer();
  if (!v || v.role !== "admin" || !canSeePeople(v.email)) notFound();
  const days = [7, 14, 30, 60].includes(Number(searchParams.d)) ? Number(searchParams.d) : 14;
  const to = todayIso(), from = addDays(to, -days);
  const people = await peopleReport(from, to);
  const hr = (h: number) => `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? "a" : "p"}`;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link prefetch={false} href="/a/pulse" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back to Pulse"><ChevronLeft /></Link>
          <div><h1 className="text-h2 font-extrabold leading-tight">How the office works</h1><p className="text-body text-ink-soft">Last {days} days, US Eastern. Actions in the app only: reading, calls and work elsewhere don&apos;t show.</p></div>
        </div>
        <nav className="flex gap-1 rounded-full border border-line bg-white p-1 text-small font-semibold">{[7, 14, 30, 60].map((d) => <Link key={d} prefetch={false} href={`/a/pulse/people?d=${d}`} className={`rounded-full px-3 py-1.5 ${d === days ? "bg-ink text-white" : "text-ink-soft"}`}>{d} days</Link>)}</nav>
      </div>
      {!people.length && <p className="panel p-5 text-ink-soft">No office actions in this range.</p>}
      <div className="space-y-4">
        {people.map((p) => { const max = Math.max(1, ...p.grid.flat()); return (
          <section key={p.who} className="panel p-4 md:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lead font-extrabold">{p.who}</h2>
              <p className="text-small text-ink-soft">{p.total} actions on {p.days} of {days} days{p.span ? ` · a typical day ${p.span.first} to ${p.span.last}` : ""} · busiest {hr(p.busiest)}</p>
            </div>
            <div className="mt-3 overflow-x-auto"><div className="min-w-[560px]">
              <div className="mb-1 flex gap-2"><span className="w-9 shrink-0" /><div className="grid flex-1 gap-[3px] text-[10px] text-ink-faint" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>{Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 3 === 0 ? hr(h) : ""}</span>)}</div></div>
              {p.grid.map((row, wd) => (
                <div key={wd} className="mb-[3px] flex items-center gap-2">
                  <span className="w-9 shrink-0 text-caption text-ink-soft">{DAYS[wd]}</span>
                  <div className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>{row.map((n, h) => <span key={h} title={`${DAYS[wd]} ${hr(h)}: ${n}`} className="h-5 rounded-[3px]" style={{ background: n ? `rgba(91, 63, 208, ${0.15 + 0.85 * (n / max)})` : "var(--line, #e7e3f3)" }} />)}</div>
                </div>))}
            </div></div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div><p className="text-small font-bold text-ink-soft">How</p><p className="mt-1 text-body"><span className={p.burstPct >= 40 ? "font-semibold text-heart" : ""}>{p.burstPct}%</span> of clicks came within 10 seconds of the one before.</p><p className="text-body">{p.lateNightPct}% were between 8pm and 6am Eastern.</p></div>
              <div><p className="text-small font-bold text-ink-soft">What</p><ul className="mt-1 text-body">{p.top.map((a) => <li key={a.action}>{a.n} × {a.action}</li>)}</ul></div>
              <div><p className="text-small font-bold text-ink-soft">In HubSpot by hand</p>{p.hubspot.n ? <p className="mt-1 text-body">{p.hubspot.n} deal changes: {p.hubspot.top.join(", ")}.</p> : <p className="mt-1 text-body text-ink-soft">None picked up in this range.</p>}
                <p className="mt-2 text-small font-bold text-ink-soft">Day by day</p><p className="mt-1 flex flex-wrap gap-1">{p.daily.map((d) => <span key={d.day} title={d.day} className="rounded bg-paper px-1.5 py-0.5 text-caption tabular-nums">{d.day.slice(5).replace("-", "/")}: {d.n}</span>)}</p></div>
            </div>
          </section>); })}
      </div>
      <p className="mt-4 text-caption text-ink-faint">For understanding how the work gets done and what to automate next. Clicks in quick runs are normal for a batch of small things; they&apos;re worth a look when they&apos;re most of what someone does.</p>
    </>
  );
}
