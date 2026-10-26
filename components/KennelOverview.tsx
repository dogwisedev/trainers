import Link from "next/link";
import { listBookings, listThreads, listTimeOff, listTrainers } from "@/lib/data";
import { soonestOpening, weekUsage } from "@/lib/capacity";
import { addDays, todayIso, weeksFrom } from "@/lib/dates";
import { Heatmap } from "@/components/Heatmap";
import { Avatar, Pill, Section } from "@/components/ui";

/** Kennels across all trainers: stats, the week-by-week heatmap and trainers to check. (Trainers → Kennels tab.) */
export async function KennelOverview() {
  const today = todayIso();
  const [trainers, bookings, off, threads] = await Promise.all([listTrainers(), listBookings({ from: addDays(today, -7) }), listTimeOff({ from: addDays(today, -7) }), listThreads()]);
  const weeks = weeksFrom(today, 12);
  const rows = trainers.map((t) => ({ t, use: weekUsage(t, bookings, off, weeks) }));
  const now = rows.map((r) => r.use[0]);
  const inNow = now.reduce((n, w) => n + w.dogs.length, 0);
  const capNow = now.reduce((n, w) => n + Math.max(0, w.cap - w.blocked), 0);
  const free4 = rows.reduce((n, r) => n + r.use.slice(0, 4).reduce((m, w) => m + w.free, 0), 0);
  const open3Now = rows.filter((r) => soonestOpening(r.use, 3) === weeks[0]).length;
  const flagged = trainers.filter((t) => t.data_flags?.length);
  const fullUp = rows.filter((r) => r.use.slice(0, 8).every((w) => w.free === 0));
  const unread = threads.filter((t) => t.unread);

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <p className="text-ink-soft">{trainers.length} active trainers across the country</p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat big={`${inNow}`} small={`dogs in training now, of ${capNow} kennels`} tone="ink" />
        <Stat big={`${capNow ? Math.round((inNow / capNow) * 100) : 0}%`} small="of kennels filled this week" />
        <Stat big={`${free4}`} small="free kennel-weeks in the next 4 weeks" />
        <Stat big={`${open3Now}`} small="trainers who can start a 3-week program now" />
      </div>

      <Section title="Who's free, week by week"><Heatmap rows={rows} weeks={weeks} /></Section>

      <div className="grid gap-x-6 md:grid-cols-2 [&>*]:min-w-0">
        <Section title="Unread messages">
          {unread.length ? (
            <ul className="panel divide-y divide-line">
              {unread.map((th) => (
                <li key={th.trainer.id}><Link prefetch={false} href={`/a/messages/${th.trainer.id}`} className="flex items-center gap-3 p-3.5 hover:bg-mint-wash">
                  <Avatar name={th.trainer.name} size={38} />
                  <div className="min-w-0 flex-1"><p className="font-semibold">{th.trainer.name}</p><p className="truncate text-body text-ink-soft">{th.last.body}</p></div>
                  <Pill tone="heart">{th.unread}</Pill>
                </Link></li>
              ))}
            </ul>
          ) : <p className="text-body text-ink-soft">All caught up.</p>}
        </Section>
        <Section title="Needs a look">
          <ul className="panel divide-y divide-line text-body">
            {fullUp.map((r) => <li key={r.t.id}><Link prefetch={false} className="flex justify-between gap-3 p-3.5 hover:bg-mint-wash" href={`/a/trainers/${r.t.id}`}><span className="shrink-0 font-semibold">{r.t.name}</span><span className="min-w-0 truncate text-ink-soft">No free kennels for 8 weeks</span></Link></li>)}
            {flagged.map((t) => <li key={t.id}><Link prefetch={false} className="flex justify-between gap-3 p-3.5 hover:bg-mint-wash" href={`/a/trainers/${t.id}`}><span className="shrink-0 font-semibold">{t.name}</span><span className="min-w-0 truncate text-ink-soft">{t.data_flags[0]}</span></Link></li>)}
            {!fullUp.length && !flagged.length && <li className="p-3.5 text-ink-soft">Nothing to check.</li>}
          </ul>
        </Section>
      </div>

    </>
  );
}

function Stat({ big, small, tone }: { big: string; small: string; tone?: "ink" }) {
  return (
    <div className={`rounded-[22px] p-4 ${tone === "ink" ? "bg-ink text-white" : "border border-line bg-white"}`}>
      <p className="text-h1 font-extrabold leading-none">{big}</p>
      <p className={`mt-2 text-small leading-snug ${tone === "ink" ? "text-white/75" : "text-ink-soft"}`}>{small}</p>
    </div>
  );
}
