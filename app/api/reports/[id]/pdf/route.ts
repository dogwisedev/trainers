import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { getReport } from "@/lib/reportData";
import { buildReport } from "@/lib/reportDoc";
import { reportPdf } from "@/lib/reportPdf";
import { reportTitle } from "@/lib/reports";

// PDF of a report. Admins: any. Trainers: their own (row level security decides what they can load).
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await getReport(params.id);
  if (!b || (v.role !== "admin" && b.report.trainer_id !== v.trainerId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const view = buildReport(b.report.kind, b.report.answers, b.report.media, { startDate: b.booking.start_date, endDate: b.booking.end_date, submittedAt: b.report.submitted_at });
  const pdf = await reportPdf(view);
  const name = reportTitle(b.report.kind, b.report.week_number, view.dog).replace(/["\/]/g, "");
  return new NextResponse(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"` } });
}
