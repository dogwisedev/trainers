import { listBookings, listTimeOff, listTrainers, requireRole } from "@/lib/data";
import { soonestOpening, weekUsage } from "@/lib/capacity";
import { short, todayIso, weekStart, weeksFrom } from "@/lib/dates";
import { BookingForm, TrainerOption } from "@/components/forms";

export default async function NewBooking({ searchParams }: { searchParams: { trainer?: string } }) {
  await requireRole("admin");
  const today = todayIso();
  const [trainers, bookings, off] = await Promise.all([listTrainers(), listBookings({ from: today }), listTimeOff({ from: today })]);
  const weeks = weeksFrom(today, 16);
  const opts: TrainerOption[] = trainers.map((t) => {
    const use = weekUsage(t, bookings, off, weeks), o = soonestOpening(use, 3);
    return { id: t.id, name: t.name, place: [t.city, t.state].filter(Boolean).join(", "), free: use[0].free, opening3: o ? (o === weekStart(today) ? "now" : short(o)) : null };
  });
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Book a dog</h1>
      <p className="mb-5 mt-1 text-ink-soft">The trainer sees it on their calendar straight away.</p>
      <div className="panel p-4 md:p-6"><BookingForm trainers={opts} defaultTrainer={searchParams.trainer} /></div>
    </>
  );
}
