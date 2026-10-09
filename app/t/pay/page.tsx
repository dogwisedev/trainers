import Link from "next/link";
import { requireRole } from "@/lib/data";
import { listMyPayslips } from "@/lib/payrollData";
import { money, periodLabel, usDate } from "@/lib/payroll";
import { Empty } from "@/components/ui";

export default async function MyPay() {
  const v = await requireRole("trainer");
  const slips = v.trainerId ? await listMyPayslips(v.trainerId) : [];
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Pay</h1>
      <p className="mb-5 mt-1 text-ink-soft">Your payslips, every other Friday. Each one is emailed to you too.</p>
      {slips.length ? (
        <ul className="space-y-2.5">
          {slips.map((s) => (
            <li key={s.id}>
              <Link href={`/t/pay/${s.id}`} className="panel flex items-center justify-between gap-3 p-4 hover:border-ink-faint">
                <div><p className="font-bold">{periodLabel(s.pay_runs.period_start, s.pay_runs.period_end)}</p><p className="text-[13px] text-ink-soft">Paid {usDate(s.pay_runs.paid_date)}</p></div>
                <p className="text-[20px] font-extrabold text-[#6B4FE0]">{money(s.total)}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : <Empty title="No payslips yet.">They appear here once the Dogwise team approves them.</Empty>}
    </>
  );
}
