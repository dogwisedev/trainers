import Link from "next/link";
import { Plus } from "lucide-react";
import { listTrainers, requireRole } from "@/lib/data";
import { TABS, Tab, bookingHistory } from "@/lib/history";
import { BookingHistory } from "@/components/BookingHistory";
import { ChatFilters } from "@/components/ChatFilters";
import { Empty } from "@/components/ui";

// Admin: every booking, past and present. In care / Upcoming / Finished / Cancelled, with search and a trainer filter.
export default async function Bookings({ searchParams }: { searchParams: { f?: string; t?: string; q?: string } }) {
  await requireRole("admin");
  const tab = (TABS.some((x) => x.key === searchParams.f) ? searchParams.f : "now") as Tab;
  const q = (searchParams.q || "").trim(), t = searchParams.t || "";
  const [trainers, { rows, more }] = await Promise.all([listTrainers(), bookingHistory({ tab, q, trainerId: t || undefined })]);
  const link = (k: Tab) => { const p = new URLSearchParams({ f: k }); if (t) p.set("t", t); if (q) p.set("q", q); return `/a/bookings?${p}`; };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px] font-extrabold">Bookings</h1>
        <Link href="/a/bookings/new" className="btn-ink h-10 min-h-0 px-4"><Plus size={17} />Book a dog</Link>
      </div>
      <p className="mb-4 mt-1 text-ink-soft">Every dog, past and present. <Link href="/a/ready" className="underline">Before training</Link> shows what&apos;s missing for dogs starting soon.</p>
      <ChatFilters base="/a/bookings" q={q} t={t} f={tab} placeholder="Search dog, client, email, trainer or deal ID" trainers={trainers.map((x) => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name))} />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((x) => <Link key={x.key} href={link(x.key)} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${x.key === tab ? "bg-ink text-white" : "border border-line bg-white"}`}>{x.label}</Link>)}
      </div>
      {rows.length ? <BookingHistory rows={rows} role="admin" showTrainer={!t} /> : <Empty title={q || t ? "No bookings match." : "Nothing here."} />}
      {more && <p className="mt-3 text-center text-[13px] text-ink-soft">Showing the first {rows.length}. Search to narrow it down.</p>}
    </>
  );
}
