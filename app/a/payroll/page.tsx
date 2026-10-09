import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/data";
import { defaultRunDate, listRuns } from "@/lib/payrollData";
import { money, periodLabel, usDate } from "@/lib/payroll";
import { Empty } from "@/components/ui";

// Archive: every past pay run. The current one lives in Trainers → Payslips.
export default async function PayRuns() {
  await requireRole("admin");
  const current = defaultRunDate();
  const runs = (await listRuns()).filter((r) => r.submit_date < current);
  return (
    <>
      <Link href="/a/trainers?view=pay" className="mb-3 inline-flex items-center gap-1 font-semibold"><ChevronLeft size={18} />Current payslips</Link>
      <h1 className="text-[30px] font-extrabold">Past pay runs</h1>
      <p className="mb-5 mt-1 text-ink-soft">Each run moves here once the next pay Monday comes round.</p>
      {runs.length ? (
        <ul className="panel divide-y divide-line">
          {runs.map((r) => (
            <li key={r.submit_date}>
              <Link href={`/a/trainers?view=pay&run=${r.submit_date}`} className="flex items-center gap-3 p-4 hover:bg-mint-wash">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{periodLabel(r.period_start, r.period_end)}</p>
                  <p className="text-[13px] text-ink-soft">Paid {usDate(r.paid_date)}, {r.approved} of {r.count} approved</p>
                </div>
                <p className="font-extrabold">{money(r.total)}</p>
                <ChevronRight size={18} className="text-ink-faint" />
              </Link>
            </li>
          ))}
        </ul>
      ) : <Empty title="No past pay runs yet." />}
    </>
  );
}
