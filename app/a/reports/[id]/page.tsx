import Link from "next/link";
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
        <Link href="/a/reports" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back to reports"><ChevronLeft /></Link>
        <div className="min-w-0">
          <h1 className="truncate text-[24px] font-extrabold leading-tight">{kindName(r.kind)}: {booking.dog_name || "Dog"}</h1>
          <p className="truncate text-[14px] text-ink-soft"><Link className="underline" href={`/a/trainers/${trainer.id}`}>{trainer.name}</Link>, client {booking.client_name}</p>
        </div>
      </div>
      <ReportForm id={r.id} kind={r.kind} mode="admin" status={r.status} bookingId={booking.id} initialAnswers={r.answers} initialMedia={r.media}
        startDate={booking.start_date} endDate={booking.end_date} submittedAt={r.submitted_at} reviewNote={r.review_note} due={r.due_by} late={b.late} demo={isDemo()} chatId={b.chat?.id ?? null}
        meta={{ approvedBy: r.approved_by_name, approvedAt: r.approved_at, sentTo: r.sent_to, sentAt: r.sent_at, error: r.send_error, byAdmin: r.by_admin }} />
    </>
  );
}
