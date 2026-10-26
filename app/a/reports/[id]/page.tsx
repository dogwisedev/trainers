import Link from "next/link";
import { HandoverTestEmail } from "@/components/HandoverTestEmail";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { getReport } from "@/lib/reportData";
import { isDemo } from "@/lib/supabase";
import { ReportForm } from "@/components/ReportForm";
import { kindName } from "@/lib/reports";

export default async function AdminReport({ params }: { params: { id: string } }) {
  await requireRole("admin");
  const b = await getReport(decodeURIComponent(params.id));
  if (!b) notFound();
  const { report: r, booking, trainer } = b;
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link prefetch={false} href={`/a/dogs/${booking.id}?tab=forms`} className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back to the dog"><ChevronLeft /></Link>
        <div className="min-w-0">
          <h1 className="truncate text-h2 font-extrabold leading-tight">{kindName(r.kind)}: {booking.dog_name || "Dog"}</h1>
          <p className="truncate text-body text-ink-soft"><Link prefetch={false} className="underline" href={`/a/trainers/${trainer.id}`}>{trainer.name}</Link>, client {booking.client_name}</p>
        </div>
      </div>
      {r.kind === "handover" && (
        <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3.5">
          <p className="min-w-0 flex-1 text-body"><b>See what the client gets.</b> Previews and the test email go only to you. Save any changes first.</p>
          <a href={`/a/reports/${r.id}/preview`} target="_blank" rel="noopener" className="btn-ghost h-9 min-h-0 px-3 text-small">Preview report PDF</a>
          <a href={`/a/reports/${r.id}/preview?doc=certificate`} target="_blank" rel="noopener" className="btn-ghost h-9 min-h-0 px-3 text-small">Preview certificate</a>
          <HandoverTestEmail id={r.id} />
        </div>
      )}
      <ReportForm id={r.id} kind={r.kind} mode="admin" status={r.status} bookingId={booking.id} week={r.week_number} initialAnswers={r.answers} initialMedia={r.media}
        startDate={booking.start_date} endDate={booking.end_date} submittedAt={r.submitted_at} reviewNote={r.review_note} due={r.due_by} late={b.late} demo={isDemo()} chatId={b.chat?.id ?? null}
        meta={{ approvedBy: r.approved_by_name, approvedAt: r.approved_at, sentTo: r.sent_to, sentAt: r.sent_at, error: r.send_error, byAdmin: r.by_admin, waivedBy: r.waived_by, waivedAt: r.waived_at }} />
    </>
  );
}
