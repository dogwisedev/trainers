import { getTrainer, listBookings, listTimeOff, requireRole } from "@/lib/data";
import { weekUsage } from "@/lib/capacity";
import { addDays, range, todayIso, weekLabel, weeksFrom } from "@/lib/dates";
import { DeleteTimeOff, TimeOffForm } from "@/components/forms";
import { Pill, Section } from "@/components/ui";

export default async function TrainerCalendar() {
  const v = await requireRole("trainer");
  const t = v.trainerId ? await getTrainer(v.trainerId) : null;
  if (!t) return null;
  const today = todayIso();
  const [bookings, off] = await Promise.all([listBookings({ trainerId: t.id, from: addDays(today, -7) }), listTimeOff({ trainerId: t.id, from: today })]);
  const use = weekUsage(t, bookings, off, weeksFrom(today, 16));
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Your calendar</h1>
      <p className="mt-1 text-ink-soft">You can take {t.capacity} dog{t.capacity === 1 ? "" : "s"} at a time. Bookings are added by the Dogwise team.</p>

      <ol className="mt-5 space-y-2.5">
        {use.map((w) => (
          <li key={w.week} className={`panel p-4 ${w.week === use[0].week ? "ring-2 ring-biscuit" : ""}`}>
            <div className="flex items-center justify-between gap-3">
              <p className="font-bold">{weekLabel(w.week)}</p>
              <div className="flex gap-1" aria-hidden>
                {Array.from({ length: w.cap }, (_, i) => (
                  <span key={i} className={`h-3.5 w-3.5 rounded-[5px] ${i < w.dogs.length ? "bg-ink" : i < w.dogs.length + w.blocked ? "kennel-blocked" : "bg-mint"}`} />
                ))}
              </div>
            </div>
            <p className="mt-1 text-[14px] text-ink-soft">
              {w.dogs.length} in, {w.free} free{w.blocked ? `, ${w.blocked >= w.cap ? "away" : `${w.blocked} blocked`}` : ""}
            </p>
            {w.dogs.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">{w.dogs.map((d) => <li key={d.id}><Pill tone="line">{d.dog_name || "Dog"} ({d.client_name})</Pill></li>)}</ul>
            )}
            {w.offNote && <p className="mt-2 text-[13px] text-heart">{w.offNote}</p>}
          </li>
        ))}
      </ol>

      <Section title="Block time off" className="scroll-mt-20" >
        <div id="time-off" className="panel p-4 md:p-6"><TimeOffForm trainerId={t.id} capacity={t.capacity} /></div>
      </Section>

      <Section title="Booked time off">
        {off.length ? (
          <ul className="panel divide-y divide-line">
            {off.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2 pl-4 pr-2">
                <div><p className="font-semibold">{range(o.start_date, o.end_date)}</p><p className="text-[13px] text-ink-soft">{o.reason}{o.slots_blocked ? `, ${o.slots_blocked} kennel${o.slots_blocked > 1 ? "s" : ""}` : ", whole calendar"}{o.note ? `. ${o.note}` : ""}</p></div>
                <DeleteTimeOff id={o.id} />
              </li>
            ))}
          </ul>
        ) : <p className="text-[14px] text-ink-soft">Nothing blocked.</p>}
      </Section>
    </>
  );
}
