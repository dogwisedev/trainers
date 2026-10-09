import Link from "next/link";
import { UserPlus } from "lucide-react";
import { listBookings, listTimeOff, listTrainers, requireRole } from "@/lib/data";
import { soonestOpening, weekUsage } from "@/lib/capacity";
import { short, todayIso, weekStart, weeksFrom } from "@/lib/dates";
import { Row, TrainerList } from "./TrainerList";
import { PayslipBoard } from "@/components/PayslipBoard";
import { defaultRunDate, getRun } from "@/lib/payrollData";
import { isPayMonday, periodLabel, runDates, usDate } from "@/lib/payroll";
import { isDemo } from "@/lib/supabase";

export default async function Trainers({ searchParams }: { searchParams: { view?: string; run?: string } }) {
  await requireRole("admin");
  const payView = searchParams.view === "pay";
  const submit = searchParams.run && isPayMonday(searchParams.run) ? searchParams.run : defaultRunDate();
  const pay = await getRun(submit);
  const pendingCount = pay.slips.filter((s) => s.status === "draft").length;
  const header = (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-[30px] font-extrabold">Trainers</h1>
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-full border border-line bg-white p-1 text-[14px] font-semibold">
          <Link href="/a/trainers" className={`rounded-full px-3.5 py-1.5 ${!payView ? "bg-ink text-white" : "text-ink-soft"}`}>Trainers</Link>
          <Link href={`/a/trainers?view=pay${searchParams.run ? `&run=${submit}` : ""}`} className={`rounded-full px-3.5 py-1.5 ${payView ? "bg-ink text-white" : "text-ink-soft"}`}>
            Payslips{pendingCount > 0 && <span className={`ml-1.5 rounded-full px-1.5 text-[12px] ${payView ? "bg-biscuit text-ink" : "bg-biscuit text-ink"}`}>{pendingCount}</span>}
          </Link>
        </div>
        {!payView && <Link href="/a/trainers/new" className="btn-mint h-10 min-h-0 px-3.5"><UserPlus size={18} />Add</Link>}
      </div>
    </div>
  );
  if (payView) {
    const d = runDates(submit);
    return (
      <>
        {header}
        <PayslipBoard key={submit} submit={submit} demo={isDemo()} label={periodLabel(d.period_start, d.period_end)} paid={usDate(d.paid_date)}
          slips={pay.slips.map((x) => ({ id: x.id, name: x.name, status: x.status, total: Number(x.total), notes: x.notes, sent_at: x.sent_at, send_error: x.send_error, missing: x.missing, lines: x.lines }))} />
      </>
    );
  }
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
      {header}
      <TrainerList rows={rows} />
    </>
  );
}
