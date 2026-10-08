import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { getTrainer, listBookings, listTimeOff, requireRole } from "@/lib/data";
import { soonestOpening, weekUsage } from "@/lib/capacity";
import { addDays, daysBetween, range, short, todayIso, weekStart, weeksFrom } from "@/lib/dates";
import { KennelLegend, KennelStrip } from "@/components/KennelStrip";
import { Empty, Pill, Section } from "@/components/ui";

export default async function TrainerHome() {
  const v = await requireRole("trainer");
  const t = v.trainerId ? await getTrainer(v.trainerId) : null;
  if (!t) return <Empty title="Your login isn't linked to a trainer profile yet.">Message the Dogwise team and they'll link it.</Empty>;
  const today = todayIso();
  const [bookings, off] = await Promise.all([listBookings({ trainerId: t.id, from: addDays(today, -7) }), listTimeOff({ trainerId: t.id, from: today })]);
  const use = weekUsage(t, bookings, off, weeksFrom(today, 12));
  const now = use[0];
  const withYou = bookings.filter((b) => b.status !== "cancelled" && b.start_date <= today && b.end_date >= today);
  const next = bookings.filter((b) => b.status !== "cancelled" && b.start_date > today).slice(0, 4);
  const open3 = soonestOpening(use, 3);
  const first = t.name.replace(/".*?"\s*/, "").split(" ")[0];

  return (
    <>
      <div className="rounded-[28px] bg-mint p-5 md:p-7">
        <p className="text-[15px] text-ink-soft">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 className="mt-1 text-[32px] font-extrabold leading-tight md:text-[40px]">Hi {first}</h1>
        <p className="mt-2 text-[16px]">
          {now.dogs.length ? `${now.dogs.length} dog${now.dogs.length > 1 ? "s" : ""} with you this week` : "No dogs with you this week"}
          {now.blocked >= now.cap && now.cap > 0 ? ", and you're marked as away." : `, ${now.free} kennel${now.free === 1 ? "" : "s"} free.`}
        </p>
        <div className="mt-5 rounded-[20px] bg-white/70 p-4">
          <KennelStrip use={use} />
          <KennelLegend />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="panel p-4"><p className="text-[13px] text-ink-soft">Dogs at one time</p><p className="text-[28px] font-extrabold">{t.capacity}</p></div>
        <div className="panel p-4"><p className="text-[13px] text-ink-soft">Next 3-week opening</p><p className="text-[22px] font-extrabold leading-9">{open3 ? (open3 === weekStart(today) ? "Now" : short(open3)) : "Full"}</p></div>
      </div>

      <Section title="With you now">
        {withYou.length ? (
          <ul className="space-y-2.5">
            {withYou.map((b) => {
              const total = daysBetween(b.start_date, b.end_date) + 1, done = Math.min(total, daysBetween(b.start_date, today) + 1);
              return (
                <li key={b.id} className="panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-[17px] font-bold">{b.dog_name || "Dog"}</p><p className="text-[14px] text-ink-soft">{b.client_name}, {range(b.start_date, b.end_date)}</p></div>
                    <Pill tone="biscuit">Week {Math.ceil(done / 7)} of {Math.ceil(total / 7)}</Pill>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full bg-biscuit" style={{ width: `${(done / total) * 100}%` }} /></div>
                  {b.notes && <p className="mt-3 text-[14px] text-ink-soft">{b.notes}</p>}
                </li>
              );
            })}
          </ul>
        ) : <Empty title="No dogs in training right now." />}
      </Section>

      <Section title="Coming up">
        {next.length ? (
          <ul className="panel divide-y divide-line">
            {next.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 p-4">
                <div><p className="font-semibold">{b.dog_name || "Dog"} <span className="font-normal text-ink-soft">with {b.client_name}</span></p><p className="text-[14px] text-ink-soft">{range(b.start_date, b.end_date)}</p></div>
                <Pill tone={b.status === "pending" ? "line" : "mint"}>{b.status === "pending" ? "Pending" : "Confirmed"}</Pill>
              </li>
            ))}
          </ul>
        ) : <Empty title="Nothing booked yet." >New dogs show up here as soon as they're booked.</Empty>}
      </Section>

      <Section title="Time off" action={<Link href="/t/calendar#time-off" className="btn-mint h-10 min-h-0 px-3 text-[14px]"><CalendarPlus size={16} />Block dates</Link>}>
        {off.length ? (
          <ul className="panel divide-y divide-line">
            {off.slice(0, 4).map((o) => (
              <li key={o.id} className="flex items-center justify-between p-4"><span>{range(o.start_date, o.end_date)}</span><Pill tone="heart">{o.slots_blocked ? `${o.slots_blocked} kennel${o.slots_blocked > 1 ? "s" : ""}` : o.reason}</Pill></li>
            ))}
          </ul>
        ) : <p className="text-[14px] text-ink-soft">No time off booked.</p>}
      </Section>
    </>
  );
}
