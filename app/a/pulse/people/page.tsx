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
          <div><h1 className="text-h2 font-extrabold leading-tight">How the office works</h1><p className="text-body text-ink-soft">Last {days} days, US Eastern. What each person did in the app and logged in HubSpot. Reading, calls and Slack don&apos;t show.</p></div>
        </div>
        <nav className="flex gap-1 rounded-full border border-line bg-white p-1 text-small font-semibold">{[7, 14, 30, 60].map((d) => <Link key={d} prefetch={false} href={`/a/pulse/people?d=${d}`} className={`rounded-full px-3 py-1.5 ${d === days ? "bg-ink text-white" : "text-ink-soft"}`}>{d} days</Link>)}</nav>
      </div>
      {!people.length && <p className="panel p-5 text-ink-soft">No office actions in this range.</p>}
      <div className="space-y-4">
        {people.map((p) => { const max = Math.max(1, ...p.grid.flat()); return (
          <section key={p.who} className="panel p-4 md:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lead font-extrabold">{p.who}</h2>
              <p className="text-small text-ink-soft">{p.total} in the app{p.hub.found ? ` · ${p.hub.total} in HubSpot` : ""} · {p.days} of {days} days{p.span ? ` · typically ${p.span.first} to ${p.span.last}` : ""}</p>
            </div>
            {p.hub.found && p.total + p.hub.total > 0 && (() => { const pct = Math.round((p.total / (p.total + p.hub.total)) * 100); return (
              <div className="mt-3"><div className="flex h-3 overflow-hidden rounded-full bg-line"><span className="bg-[#5b3fd0]" style={{ width: `${pct}%` }} /><span className="bg-[#f0a35c]" style={{ width: `${100 - pct}%` }} /></div>
                <p className="mt-1 text-caption text-ink-soft"><span className="font-semibold text-[#5b3fd0]">{pct}% in the app</span> · <span className="font-semibold text-[#c2701f]">{100 - pct}% in HubSpot</span> (notes, calls, emails, tasks and meetings they logged there)</p></div>); })()}
            <p className="mt-4 text-small font-bold text-ink-soft">In the app, by weekday and hour</p>
            <div className="mt-1 overflow-x-auto"><div className="min-w-[560px]">
              <div className="mb-1 flex gap-2"><span className="w-9 shrink-0" /><div className="grid flex-1 gap-[3px] text-[10px] text-ink-faint" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>{Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 3 === 0 ? hr(h) : ""}</span>)}</div></div>
              {p.grid.map((row, wd) => (
                <div key={wd} className="mb-[3px] flex items-center gap-2">
                  <span className="w-9 shrink-0 text-caption text-ink-soft">{DAYS[wd]}</span>
                  <div className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>{row.map((n, h) => <span key={h} title={`${DAYS[wd]} ${hr(h)}: ${n}`} className="h-5 rounded-[3px]" style={{ background: n ? `rgba(91, 63, 208, ${0.15 + 0.85 * (n / max)})` : "var(--line, #e7e3f3)" }} />)}</div>
                </div>))}
              {p.hub.found && p.hub.total > 0 && (() => { const hm = Math.max(1, ...p.hub.hours); return (
                <div className="mt-2 flex items-center gap-2"><span className="w-9 shrink-0 text-caption font-semibold text-[#c2701f]">HS</span>
                  <div className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>{p.hub.hours.map((n, h) => <span key={h} title={`HubSpot ${hr(h)}: ${n}`} className="h-5 rounded-[3px]" style={{ background: n ? `rgba(240, 163, 92, ${0.2 + 0.8 * (n / hm)})` : "var(--line, #e7e3f3)" }} />)}</div></div>); })()}
            </div></div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-small font-bold text-ink-soft">What kind of work (in the app)</p>
                <ul className="mt-1.5 space-y-1.5">{p.cats.map((c) => <li key={c.name} className="text-body"><div className="flex justify-between"><span>{c.name}</span><span className="tabular-nums text-ink-soft">{c.n} · {Math.round((c.n / p.total) * 100)}%</span></div><div className="mt-0.5 h-1.5 rounded-full bg-line"><div className="h-1.5 rounded-full bg-[#5b3fd0]" style={{ width: `${Math.round((c.n / p.total) * 100)}%` }} /></div></li>)}</ul>
              </div>
              <div>
                <p className="text-small font-bold text-ink-soft">Most often</p>
                <ul className="mt-1 text-body">{p.top.map((a) => <li key={a.action}><span className="tabular-nums text-ink-soft">{a.n} ×</span> {a.action}</li>)}</ul>
                <p className="mt-3 text-small font-bold text-ink-soft">How</p>
                <p className="mt-1 text-body">Active in {p.activeHours} different hours · busiest {hr(p.busiest)}.</p>
                <p className="text-body"><span className={p.burstPct >= 40 ? "font-semibold text-heart" : ""}>{p.burstPct}%</span> of clicks within 10 seconds of the one before.</p>
                {p.lateNightPct >= 10 && <p className="text-body">{p.lateNightPct}% between 8pm and 6am Eastern.</p>}
              </div>
              <div>
                <p className="text-small font-bold text-ink-soft">In HubSpot</p>
                {!p.hub.found ? <p className="mt-1 text-body text-ink-soft">No HubSpot user matched to this login.</p> : p.hub.total + p.hub.changes === 0 ? <p className="mt-1 text-body text-ink-soft">Nothing logged by {p.hub.owner} in this range.</p> : (
                  <ul className="mt-1 text-body">
                    {([["notes", "notes written"], ["calls", "calls logged"], ["emails", "emails logged"], ["tasks", "tasks"], ["meetings", "meetings"]] as const).filter(([k]) => p.hub[k] > 0).map(([k, l]) => <li key={k}><span className="tabular-nums text-ink-soft">{p.hub[k]} ×</span> {l}</li>)}
                    {p.hub.changes > 0 && <li><span className="tabular-nums text-ink-soft">{p.hub.changes} ×</span> deal fields changed by hand ({p.hub.changed.join(", ")})</li>}
                  </ul>)}
                <p className="mt-3 text-small font-bold text-ink-soft">Day by day <span className="font-normal">(app · HubSpot)</span></p>
                <p className="mt-1 flex flex-wrap gap-1">{p.daily.map((d) => <span key={d.day} title={d.day} className="rounded bg-paper px-1.5 py-0.5 text-caption tabular-nums">{d.day.slice(5).replace("-", "/")}: {d.app}{p.hub.found ? ` · ${d.hubspot}` : ""}</span>)}</p>
              </div>
            </div>
          </section>); })}
      </div>
      <p className="mt-4 text-caption text-ink-faint">For understanding how the work gets done and what to automate next. Clicks in quick runs are normal for a batch of small things; they&apos;re worth a look when they&apos;re most of what someone does.</p>
    </>
  );
}
