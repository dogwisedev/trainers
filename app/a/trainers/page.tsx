import Link from "next/link";
import { UserPlus } from "lucide-react";
import { listBookings, listTimeOff, listTrainers, requireRole } from "@/lib/data";
import { soonestOpening, weekUsage } from "@/lib/capacity";
import { short, todayIso, weekStart, weeksFrom } from "@/lib/dates";
import { Row, TrainerList } from "./TrainerList";
import { PayslipBoard } from "@/components/PayslipBoard";
import { buildDrafts, currentRunDate, getRun } from "@/lib/payrollData";
import { serverClient } from "@/lib/supabase";
import { isPayMonday, periodLabel, runDates, usDate } from "@/lib/payroll";
import { isDemo } from "@/lib/supabase";
import { trainerSignins } from "@/lib/trainerSignin";
import { SigninHello } from "@/components/SigninHello";
import { KennelOverview } from "@/components/KennelOverview";

export default async function Trainers({ searchParams }: { searchParams: { view?: string; run?: string } }) {
  await requireRole("admin");
  const payView = searchParams.view === "pay";
  const kennels = searchParams.view === "kennels";
  const current = await currentRunDate();
  const submit = searchParams.run && isPayMonday(searchParams.run) ? searchParams.run : current;
  // The current run refreshes itself whenever the Payslips view opens: every booked day in its two weeks,
  // trained yet or not. Approved payslips and hand edits are left alone; archived runs are never touched.
  if (payView && !isDemo() && submit === current) {
    try { await buildDrafts(serverClient(), submit); } catch { /* shows what's there; Refresh drafts can retry */ }
  }
  const pay = await getRun(submit);
  const pendingCount = pay.slips.filter((s) => s.status === "draft").length;
  const header = (
    <div className="mb-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[32px] font-extrabold leading-tight">Trainers</h1>
        {!payView && !kennels && <Link prefetch={false} href="/a/trainers/new" className="btn-ink h-10 min-h-0 shrink-0 px-3.5 text-[14px]"><UserPlus size={17} />Add trainer</Link>}
      </div>
      <nav className="grid grid-cols-3 rounded-2xl border border-line bg-white p-1 text-[14px] font-semibold shadow-card sm:inline-grid sm:w-auto" aria-label="Trainers views">
        <Link prefetch={false} href="/a/trainers" aria-current={!payView && !kennels ? "page" : undefined} className={`rounded-xl px-3.5 py-2 text-center ${!payView && !kennels ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>Trainers</Link>
        <Link prefetch={false} href="/a/trainers?view=kennels" aria-current={kennels ? "page" : undefined} className={`rounded-xl px-3.5 py-2 text-center ${kennels ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>Kennels</Link>
        <Link prefetch={false} href={`/a/trainers?view=pay${searchParams.run ? `&run=${submit}` : ""}`} aria-current={payView ? "page" : undefined} className={`rounded-xl px-3.5 py-2 text-center ${payView ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>
          Payslips{pendingCount > 0 && <span className="ml-1.5 rounded-full bg-biscuit px-1.5 text-[12px] text-ink">{pendingCount}</span>}
        </Link>
      </nav>
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
  if (kennels) return <>{header}<KennelOverview /></>;
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
  const notIn = isDemo() ? [] : (await trainerSignins().catch(() => [])).filter((r) => !r.lastSignIn);
  return (
    <>
      {header}
      {notIn.length > 0 && <SigninHello rows={notIn} />}
      <TrainerList rows={rows} />
    </>
  );
}
