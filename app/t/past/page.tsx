import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { bookingHistory } from "@/lib/history";
import { BookingHistory } from "@/components/BookingHistory";
import { ChatFilters } from "@/components/ChatFilters";
import { Empty } from "@/components/ui";

// Trainer: dogs they've finished training, newest first, with their forms and the Dog profile.
export default async function PastDogs({ searchParams }: { searchParams: { q?: string } }) {
  const v = await requireRole("trainer");
  const q = (searchParams.q || "").trim();
  const { rows, more } = v.trainerId ? await bookingHistory({ tab: "finished", q, trainerId: v.trainerId, limit: 100 }) : { rows: [], more: false };
  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <Link href="/t" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back"><ChevronLeft /></Link>
        <h1 className="text-[30px] font-extrabold">Past dogs</h1>
      </div>
      <p className="mb-4 text-ink-soft">Dogs you&apos;ve finished training, with their forms.</p>
      <ChatFilters base="/t/past" q={q} placeholder="Search dog or client" />
      {rows.length ? <BookingHistory rows={rows} role="trainer" showTrainer={false} /> : <Empty title={q ? "No dogs match." : "No finished trainings yet."} />}
      {more && <p className="mt-3 text-center text-[13px] text-ink-soft">Showing the latest {rows.length}. Search to find older ones.</p>}
    </>
  );
}
