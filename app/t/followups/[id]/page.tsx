import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { FollowupDates } from "@/components/FollowupDates";

// Trainer: book the follow-up sessions for one of their dogs (dates saved on the HubSpot deal).
export default async function TrainerFollowups({ params }: { params: { id: string } }) {
  const v = await requireRole("trainer");
  if (isDemo()) return <p className="panel p-6 text-ink-soft">Not available in demo mode.</p>;
  const sb = serviceClient();
  const { data: b } = await sb.from("bookings").select("id, trainer_id, dog_name, client_name, hubspot_deal_id").eq("id", params.id).maybeSingle();
  if (!b || b.trainer_id !== v.trainerId) notFound();
  const { data: m } = b.hubspot_deal_id ? await sb.from("deal_money").select("followups").eq("deal_id", b.hubspot_deal_id).maybeSingle() : { data: null };
  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <Link href="/t/past" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back"><ChevronLeft /></Link>
        <h1 className="text-[28px] font-extrabold leading-tight">Follow-up sessions</h1>
      </div>
      <p className="mb-4 text-ink-soft">{b.dog_name || "Dog"}, {b.client_name}. Set the session dates: each one is paid on the payslip for that date.</p>
      <div className="panel p-4">{b.hubspot_deal_id ? <FollowupDates bookingId={b.id} dates={(m?.followups as string[] | undefined) || []} /> : <p className="text-ink-soft">This booking has no HubSpot deal. Ask the team.</p>}</div>
    </>
  );
}
