import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data";
import { canSeePulse } from "@/lib/preview";
import { pulse, snapshotCached } from "@/lib/pulse";
import { PulseView } from "@/components/PulseView";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // building the snapshot can take a while the first time

/** Pulse: the dashboard preview. Admins on the PULSE_EMAILS list only (default Alma); everyone else gets a 404. */
export default async function PulsePage({ searchParams }: { searchParams: { r?: string; from?: string; to?: string; v?: string; state?: string } }) {
  const v = await requireRole("admin");
  if (!canSeePulse(v.email)) notFound();
  const snap = await snapshotCached();                       // one 90-day pull, kept for an hour (Refresh rebuilds it)
  const p = await pulse(searchParams, snap);                 // every range and view is worked out from it: instant
  return <PulseView p={p} q={searchParams} />;
}
