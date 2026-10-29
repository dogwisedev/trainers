import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { buildDrafts, currentRunDate, getPayslip } from "@/lib/payrollData";
import { TRIP_LABEL, periodLabel, usDate } from "@/lib/payroll";
import { PayslipEditor } from "@/components/PayslipEditor";
import { Avatar } from "@/components/ui";
import { MileageCheck } from "@/components/MileageCheck";
import { freerouteOn, mileageRows } from "@/lib/tripRoutes";
import { isDemo, serverClient } from "@/lib/supabase";

export const maxDuration = 60; // "Check now" on the mileage check works out routes

export default async function PayslipPage({ params, searchParams }: { params: { id: string }; searchParams: { edit?: string } }) {
  await requireRole("admin");
  let p = await getPayslip(params.id);
  if (!p) notFound();
  // A draft in the current run is brought up to date from bookings and trips when it opens (same rules as the Payslips
  // list: hand edits kept, deleted lines stay deleted), so a trip saved since the list was last opened is on it.
  let refreshError: string | null = null;
  if (!isDemo() && p.slip.status === "draft" && p.run.submit_date === await currentRunDate()) {
    try {
      const b = await buildDrafts(serverClient(), p.run.submit_date, p.slip.trainer_id);
      if (b.changedNames.length) p = (await getPayslip(params.id)) || p;
    } catch (e) { refreshError = (e as Error).message; }
  }
  const name = p.trainer?.name || p.slip.trainer_name || "Trainer";
  const miles = isDemo() ? [] : await mileageRows(p.slip.trainer_id, p.run.period_start, p.run.period_end).catch(() => []);
  // Each trip's pay line on this payslip ("Pickup 10/28: 310 mi, …"), or null if it isn't on it
  const routeLines = p.lines.filter((l) => l.kind === "route");
  const onSlip = Object.fromEntries(miles.map((m) => {
    const tag = `${TRIP_LABEL[m.kind]} ${m.date.slice(5).replace("-", "/")}`;
    const line = routeLines.find((l) => l.booking_id === m.bookingId && String(l.program || "").startsWith(tag))
      || routeLines.find((l) => !l.booking_id && String(l.program || "").startsWith(tag)); // a route line typed by hand
    return [m.tripId, line ? Number(line.amount) : null];
  })) as Record<string, number | null>;
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link prefetch={false} href={`/a/trainers?view=pay&run=${p.run.submit_date}`} className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back to payslips"><ChevronLeft /></Link>
        <Avatar name={name} size={42} />
        <div className="min-w-0">
          <Link prefetch={false} href={`/a/trainers/${p.slip.trainer_id}`} className="block truncate text-h3 font-extrabold hover:underline">{name}</Link>
          <p className="text-small text-ink-soft">{periodLabel(p.run.period_start, p.run.period_end)}, paid {usDate(p.run.paid_date)}</p>
        </div>
      </div>
      {refreshError && <p role="alert" className="mb-4 rounded-xl bg-heart-wash px-3 py-2 text-body text-heart">Couldn&apos;t update this payslip from bookings and trips: {refreshError}. The lines below may be out of date.</p>}
      {miles.length > 0 && <div className="mb-4"><MileageCheck rows={miles} payslipId={p.slip.id} setUp={freerouteOn()} onSlip={onSlip} /></div>}
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
