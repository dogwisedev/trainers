import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { addDays, short, todayIso } from "@/lib/dates";
import { FollowupForm } from "@/components/FollowupForm";

// Trainer: log a follow-up session. The miles go on the next payslip; the notes show on the dog's page for the team.
export default async function Followup({ searchParams }: { searchParams: { b?: string } }) {
  const v = await requireRole("trainer");
  const today = todayIso();
  const { data } = isDemo() || !v.trainerId ? { data: [] } : await serviceClient().from("bookings").select("id, dog_name, client_name, end_date").eq("trainer_id", v.trainerId).neq("status", "cancelled").gte("end_date", addDays(today, -365)).lte("start_date", today).order("end_date", { ascending: false });
  const dogs = ((data || []) as { id: string; dog_name: string | null; client_name: string; end_date: string }[]).map((b) => ({ id: b.id, label: `${b.dog_name || "Dog"} (${b.client_name}), finished ${short(b.end_date)}` }));
  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <Link prefetch={false} href="/t/past" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back"><ChevronLeft /></Link>
        <h1 className="text-h1 font-extrabold">Follow-up session</h1>
      </div>
      <p className="mb-4 text-ink-soft">Log each follow-up session: the miles are added to your next payslip, and the team can see what you worked on.</p>
      <FollowupForm dogs={dogs} dog={searchParams.b} today={today} />
    </>
  );
}
