import Link from "next/link";
import { requireRole } from "@/lib/data";
import { listMyPayslips } from "@/lib/payrollData";
import { money, periodLabel, usDate } from "@/lib/payroll";
import { Empty } from "@/components/ui";
import { tripsFor } from "@/lib/trips";
import { TRIP_LABEL } from "@/lib/payroll";
import { isDemo } from "@/lib/supabase";

export default async function MyPay() {
  const v = await requireRole("trainer");
  const slips = v.trainerId ? await listMyPayslips(v.trainerId) : [];
  const year = new Date().getFullYear();
  const trips = v.trainerId && !isDemo() ? await tripsFor({ trainerId: v.trainerId, from: `${year}-01-01` }) : [];
  const total = Math.round(trips.reduce((n, t) => n + Number(t.miles), 0) * 10) / 10;
  return (
    <>
      <h1 className="text-h1 font-extrabold" data-tour="pay">Pay</h1>
      <p className="mb-5 mt-1 text-ink-soft">Your payslips, every other Friday. Each one is emailed to you too.</p>
      {slips.length ? (
        <ul className="space-y-2.5">
          {slips.map((s) => (
            <li key={s.id}>
              <Link prefetch={false} href={`/t/pay/${s.id}`} className="panel flex items-center justify-between gap-3 p-4 hover:border-ink-faint">
                <div><p className="font-bold">{periodLabel(s.pay_runs.period_start, s.pay_runs.period_end)}</p><p className="text-small text-ink-soft">Paid {usDate(s.pay_runs.paid_date)}</p></div>
                <p className="text-h3 font-extrabold text-lav-deep">{money(s.total)}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : <Empty title="No payslips yet.">They appear here once the Dogwise team approves them.</Empty>}

      <section className="mt-8" data-tour="miles">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-h3 font-extrabold">Your miles in {year}</h2><p className="text-small text-ink-soft">{trips.length} trip{trips.length === 1 ? "" : "s"}, {total} miles. Keep this for tax time.</p></div>
          <Link prefetch={false} href="/t/followup" className="btn-ghost h-9 min-h-0 px-3 text-small">Log a follow-up session</Link>
        </div>
        {trips.length ? (
          <ul className="panel divide-y divide-line text-body">
            {trips.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 p-3">
                <span><span className="font-semibold">{usDate(t.trip_date)}</span> <span className="text-ink-soft">{TRIP_LABEL[t.kind]}{t.bookings?.dog_name ? `, ${t.bookings.dog_name}` : ""}</span></span>
                <span className="font-semibold">{Number(t.miles)} mi</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-body text-ink-soft">Miles from your pickup, drop-off and follow-up forms show here.</p>}
      </section>
    </>
  );
}
