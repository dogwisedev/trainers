import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { getPayslip, toSlipData } from "@/lib/payrollData";
import { payslipPdf } from "@/lib/payslipPdf";

// PDF of a payslip. Admins: any. Trainers: their own approved ones (also enforced by row level security).
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const p = await getPayslip(params.id);
  if (!p || (v.role !== "admin" && (p.slip.trainer_id !== v.trainerId || p.slip.status !== "approved"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const d = toSlipData(p.slip, p.run, p.lines, p.trainer);
  const pdf = await payslipPdf(d);
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Payslip ${d.trainer_name.replace(/["\/]/g, "")} ${d.paid_date}.pdf"` }
  });
}
