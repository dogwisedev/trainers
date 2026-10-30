import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data";
import { canSeePulse } from "@/lib/preview";
import { pulse, snapshotCached } from "@/lib/pulse";
import { PulseView } from "@/components/PulseView";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pulse: the dashboard preview. Admins on the PULSE_EMAILS list only (default Alma); everyone else gets a 404. */
export default async function PulsePage({ searchParams }: { searchParams: { r?: string; from?: string; to?: string; v?: string; state?: string } }) {
  const v = await requireRole("admin");
  if (!canSeePulse(v.email)) notFound();
  try {
    const snap = await snapshotCached();                     // one 90-day pull in three parallel parts, kept for an hour (Refresh rebuilds it)
    const p = await pulse(searchParams, snap);               // every range and view is worked out from it: instant
    return <PulseView p={p} q={searchParams} />;
  } catch (e) {
    // A preview: say what went wrong rather than a generic error screen
    return <div className="panel p-5"><h1 className="text-lead font-extrabold">Pulse couldn&apos;t load</h1><p className="mt-2 text-body text-heart">{(e as Error).message}</p><p className="mt-2 text-small text-ink-soft">Try again in a moment; if it keeps happening, send Alma this message.</p></div>;
  }
}
