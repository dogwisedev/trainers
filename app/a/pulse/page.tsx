import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data";
import { canSeePulse } from "@/lib/preview";
import { pulse } from "@/lib/pulse";
import { PulseView } from "@/components/PulseView";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pulse: the dashboard preview. Admins on the PULSE_EMAILS list only (default Alma); everyone else gets a 404. */
export default async function PulsePage({ searchParams }: { searchParams: { r?: string; from?: string; to?: string } }) {
  const v = await requireRole("admin");
  if (!canSeePulse(v.email)) notFound();
  const p = await pulse(searchParams);
  return <PulseView p={p} q={searchParams} />;
}
