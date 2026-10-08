import Link from "next/link";
import { UserPlus } from "lucide-react";
import { listBookings, listTimeOff, listTrainers, requireRole } from "@/lib/data";
import { soonestOpening, weekUsage } from "@/lib/capacity";
import { short, todayIso, weekStart, weeksFrom } from "@/lib/dates";
import { Row, TrainerList } from "./TrainerList";

export default async function Trainers() {
  await requireRole("admin");
  const today = todayIso();
  const [trainers, bookings, off] = await Promise.all([listTrainers({ includeInactive: true }), listBookings({ from: today }), listTimeOff({ from: today })]);
  const weeks = weeksFrom(today, 16);
  const rows: Row[] = trainers.map((t) => {
    const use = weekUsage(t, bookings, off, weeks);
    const o = soonestOpening(use, 3);
    return { id: t.id, name: t.name, place: [t.city, t.state].filter(Boolean).join(", "), state: t.state || "", cap: t.capacity,
      inNow: use[0].dogs.length, freeNow: use[0].free, away: use[0].cap > 0 && use[0].blocked >= use[0].cap,
      opening: !o ? "not in 16 weeks" : o === weekStart(today) ? "now" : `from ${short(o)}`, active: t.active, flags: t.data_flags?.length || 0 };
  });
  return (
    <>
      <div className="mb-4 flex items-end justify-between gap-3">
        <h1 className="text-[30px] font-extrabold">Trainers</h1>
        <Link href="/a/trainers/new" className="btn-mint h-11 px-3.5"><UserPlus size={18} />Add</Link>
      </div>
      <TrainerList rows={rows} />
    </>
  );
}
