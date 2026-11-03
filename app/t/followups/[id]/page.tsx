import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { followupState } from "@/lib/followups";
import { FollowupPlanner } from "@/components/FollowupPlanner";

// Trainer: the 3 follow-up sessions for one of their dogs. Confirm the client's request (or set one up), change or
// cancel it, and log it once it's happened. Dates go on the HubSpot deal; each session is paid on the payslip for its date.
export default async function TrainerFollowups({ params }: { params: { id: string } }) {
  const v = await requireRole("trainer");
  if (isDemo()) return <p className="panel p-6 text-ink-soft">Not available in demo mode.</p>;
  const sb = serviceClient();
  const { data: b } = await sb.from("bookings").select("id, trainer_id, dog_name, client_name, hubspot_deal_id").eq("id", params.id).maybeSingle();
  if (!b || b.trainer_id !== v.trainerId) notFound();
  const st = await followupState(b.id, sb);
  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <Link prefetch={false} href="/t/past" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back"><ChevronLeft /></Link>
        <h1 className="text-h1 font-extrabold leading-tight">Follow-up sessions</h1>
      </div>
      <p className="mb-4 text-ink-soft">{b.dog_name || "Dog"}, {b.client_name}. Three sessions come with the program. Each one is paid on the payslip for its date.</p>
      {!b.hubspot_deal_id ? <p className="panel p-4 text-ink-soft">This booking has no HubSpot deal. Ask the team.</p>
        : st ? <FollowupPlanner bookingId={b.id} sessions={st.sessions.map((x) => ({ id: x.id, n: x.n, status: x.status, options: x.options || [], note: x.note, at: x.at, duration_min: x.duration_min }))} nextN={st.nextN} handedOver={st.handedOver} logHref={`/t/followup?b=${b.id}`} />
        : <p className="panel p-4 text-ink-soft">This booking was cancelled.</p>}
    </>
  );
}
