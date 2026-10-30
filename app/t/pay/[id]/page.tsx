import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Download } from "lucide-react";
import { requireRole } from "@/lib/data";
import { getPayslip, toSlipData } from "@/lib/payrollData";
import { leadText, lineClient, lineProgram, payslipHtml } from "@/lib/payslipDoc";
import { money, periodLabel, usDate } from "@/lib/payroll";

export default async function MyPayslip({ params }: { params: { id: string } }) {
  const v = await requireRole("trainer");
  const p = await getPayslip(params.id); // row level security: only this trainer's approved payslips
  if (!p || p.slip.trainer_id !== v.trainerId || p.slip.status !== "approved") notFound();
  const d = toSlipData(p.slip, p.run, p.lines, p.trainer);
  const html = payslipHtml(d, "/brand-logo.png");
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link prefetch={false} href="/t/pay" className="inline-flex items-center gap-1 font-semibold"><ChevronLeft size={18} />All payslips</Link>
        <a href={`/api/payslips/${p.slip.id}/pdf`} className="btn-mint h-10 min-h-0 px-3 text-body"><Download size={16} />PDF</a>
      </div>
      {/* Phones: stacked, total first. Wider screens: the payslip exactly as emailed. */}
      <div className="space-y-3 md:hidden">
        <section className="panel overflow-hidden">
          <div className="h-1.5 bg-[linear-gradient(90deg,#281870,#6E4FE0)]" />
          <div className="p-4">
            <p className="text-small font-semibold text-ink-soft">Paid {usDate(d.paid_date)}</p>
            <p className="mt-1 text-display font-extrabold text-lav-deep">{money(d.total)}</p>
            <p className="mt-1 text-small text-ink-soft">For {periodLabel(d.period_start, d.period_end)}</p>
          </div>
        </section>
        <ul className="panel divide-y divide-line overflow-hidden">
          {d.lines.map((l, i) => {
            const neg = Number(l.amount) < 0, lead = leadText(l), wide = l.kind === "deduction" || l.kind === "other";
            return (
              <li key={i} className="flex items-start gap-3 p-3.5">
                {lead ? <span className={`mt-0.5 shrink-0 rounded-lg px-2 py-0.5 text-caption font-bold ${neg ? "bg-heart-wash text-heart" : "bg-paper text-ink"}`}>{lead}</span> : null}
                <div className="min-w-0 flex-1">
                  {wide ? <p className={neg ? "text-heart" : ""}>{lineClient(l)}</p> : (
                    <>
                      <p className="font-semibold">{l.dog || lineProgram(l) || "—"}</p>
                      <p className="text-small text-ink-soft">{[l.client, l.dog ? lineProgram(l) : ""].filter(Boolean).join(" · ")}</p>
                    </>
                  )}
                </div>
                <p className={`shrink-0 font-bold ${neg ? "text-heart" : ""}`}>{money(l.amount)}</p>
              </li>
            );
          })}
        </ul>
        <section className="panel space-y-1.5 p-4 text-body">
          <p className="flex justify-between"><span className="text-ink-soft">Subtotal</span><span>{money(d.subtotal)}</span></p>
          <p className="flex justify-between"><span className="text-ink-soft">Adjustments</span><span>{money(d.adjustments)}</span></p>
          <p className="flex justify-between border-t border-line pt-2 text-lead font-extrabold"><span>Total</span><span>{money(d.total)}</span></p>
          {d.notes && <p className="pt-2 text-small text-ink-soft">{d.notes}</p>}
        </section>
      </div>
      <div className="hidden overflow-x-auto rounded-[18px] border border-line bg-[#fff] p-2 text-[#281870] md:block"><div className="min-w-[560px]" dangerouslySetInnerHTML={{ __html: html }} /></div>
    </>
  );
}
