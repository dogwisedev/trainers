import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Download } from "lucide-react";
import { requireRole } from "@/lib/data";
import { getPayslip, toSlipData } from "@/lib/payrollData";
import { payslipHtml } from "@/lib/payslipDoc";

export default async function MyPayslip({ params }: { params: { id: string } }) {
  const v = await requireRole("trainer");
  const p = await getPayslip(params.id); // row level security: only this trainer's approved payslips
  if (!p || p.slip.trainer_id !== v.trainerId || p.slip.status !== "approved") notFound();
  const html = payslipHtml(toSlipData(p.slip, p.run, p.lines, p.trainer), "/brand-logo.png");
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/t/pay" className="inline-flex items-center gap-1 font-semibold"><ChevronLeft size={18} />All payslips</Link>
        <a href={`/api/payslips/${p.slip.id}/pdf`} className="btn-mint h-10 min-h-0 px-3 text-[14px]"><Download size={16} />PDF</a>
      </div>
      <div className="overflow-x-auto rounded-[18px] border border-line bg-white p-2"><div className="min-w-[560px]" dangerouslySetInnerHTML={{ __html: html }} /></div>
    </>
  );
}
