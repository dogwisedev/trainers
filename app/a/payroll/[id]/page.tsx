import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { getPayslip } from "@/lib/payrollData";
import { periodLabel, usDate } from "@/lib/payroll";
import { PayslipEditor } from "@/components/PayslipEditor";
import { Avatar } from "@/components/ui";

export default async function PayslipPage({ params, searchParams }: { params: { id: string }; searchParams: { edit?: string } }) {
  await requireRole("admin");
  const p = await getPayslip(params.id);
  if (!p) notFound();
  const name = p.trainer?.name || p.slip.trainer_name || "Trainer";
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/a/trainers?view=pay&run=${p.run.submit_date}`} className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back to payslips"><ChevronLeft /></Link>
        <Avatar name={name} size={42} />
        <div className="min-w-0">
          <Link href={`/a/trainers/${p.slip.trainer_id}`} className="block truncate text-[20px] font-extrabold hover:underline">{name}</Link>
          <p className="text-[13px] text-ink-soft">{periodLabel(p.run.period_start, p.run.period_end)}, paid {usDate(p.run.paid_date)}</p>
        </div>
      </div>
      <PayslipEditor
        id={p.slip.id} approved={p.slip.status === "approved"}
        initial={p.lines.map((l) => ({ kind: l.kind, booking_id: l.booking_id, weeks_completed: l.weeks_completed, days: l.days ?? null, week_from: l.week_from, pct: l.pct, client: l.client, dog: l.dog, program: l.program, description: l.description, amount: Number(l.amount), auto: l.auto }))}
        adjustments={Number(p.slip.adjustments)} notes={p.slip.notes || ""} rates={p.rates}
        bookings={p.bookings.map((b) => ({ id: b.id, client: b.client_name, dog: b.dog_name || "" }))}
        doc={{ trainer_name: name, trainer_address: p.slip.trainer_address ?? p.trainer?.address ?? null, submit_date: p.run.submit_date, paid_date: p.run.paid_date, period_start: p.run.period_start, period_end: p.run.period_end }}
        startEditing={searchParams.edit === "1"}
        status={{ approvedBy: p.slip.approved_by_name, approvedAt: p.slip.approved_at, sentTo: p.slip.sent_to, sentAt: p.slip.sent_at, error: p.slip.send_error }}
      />
    </>
  );
}
