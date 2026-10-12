import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { getReport } from "@/lib/reportData";
import { isDemo } from "@/lib/supabase";
import { ReportForm } from "@/components/ReportForm";

export default async function TrainerReport({ params }: { params: { id: string } }) {
  const v = await requireRole("trainer");
  const b = await getReport(decodeURIComponent(params.id));
  if (!b || b.report.trainer_id !== v.trainerId) notFound();
  const { report: r, booking } = b;
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/t/reports" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="All reports"><ChevronLeft /></Link>
        <div className="min-w-0">
          <h1 className="truncate text-[24px] font-extrabold leading-tight">{r.kind === "weekly" ? `Week ${r.week_number} report` : "Handover report"}</h1>
          <p className="truncate text-[14px] text-ink-soft">{booking.dog_name || "Dog"}, {booking.client_name}</p>
        </div>
      </div>
      <ReportForm id={r.id} kind={r.kind} mode="trainer" status={r.status} bookingId={booking.id} initialAnswers={r.answers} initialMedia={r.media}
        startDate={booking.start_date} endDate={booking.end_date} submittedAt={r.submitted_at} reviewNote={r.review_note} due={r.due_by} late={b.late} demo={isDemo()}
        meta={{ approvedBy: r.approved_by_name, approvedAt: r.approved_at, sentTo: r.sent_to, sentAt: r.sent_at, error: r.send_error, byAdmin: r.by_admin }} />
    </>
  );
}
