import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { listTrainers, requireRole } from "@/lib/data";
import { TABS, Tab, bookingHistory } from "@/lib/history";
import { readinessFor } from "@/lib/pretraining";
import { BookingHistory } from "@/components/BookingHistory";
import { ChatFilters } from "@/components/ChatFilters";
import { Empty } from "@/components/ui";
import { StandbyList } from "@/components/StandbyList";

// Admin: every dog (booking), past and present. In care / Upcoming / Finished / Cancelled, with search and a trainer filter.
export default async function Dogs({ searchParams }: { searchParams: { f?: string; t?: string; q?: string; p?: string } }) {
  await requireRole("admin");
  const standby = searchParams.f === "standby";
  const tab = (TABS.some((x) => x.key === searchParams.f) ? searchParams.f : "now") as Tab;
  const q = (searchParams.q || "").trim(), t = searchParams.t || "", poc = (searchParams.p || "").trim();
  const trainers = await listTrainers({ includeInactive: true });
  // POC filter: the trainers whose Point of Contact is this name
  const pocs = [...new Map(trainers.map((x) => String((x as { poc?: string | null }).poc || "").trim()).filter(Boolean).map((x) => [x.toLowerCase(), x] as const)).values()].sort();
  const pocIds = poc ? trainers.filter((x) => String((x as { poc?: string | null }).poc || "").trim().toLowerCase() === poc.toLowerCase()).map((x) => x.id) : undefined;
  const { rows, more } = standby ? { rows: [], more: false } : await bookingHistory({ tab, q, trainerId: t || undefined, trainerIds: pocIds, admin: true });
  const ready = tab === "now" || tab === "upcoming" ? await readinessFor(rows.map((r) => r.id)) : new Map();
  const readyBadges = Object.fromEntries([...ready.entries()].map(([id, x]) => [id, { missing: x.ready.missing.length, cleared: !!x.dog.cleared }]));
  const params = (k: Tab | "standby", pp = poc) => { const p = new URLSearchParams({ f: k }); if (t) p.set("t", t); if (q) p.set("q", q); if (pp) p.set("p", pp); return p; };
  const link = (k: Tab | "standby") => `/a/dogs?${params(k)}`;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-extrabold">Dogs</h1>
        <span className="flex flex-wrap gap-2">
          {!standby && <a href={`/api/dogs/export?${params(tab)}`} className="btn-ghost h-10 min-h-0 px-4"><Download size={16} />Export CSV</a>}
          <Link prefetch={false} href="/a/bookings/new" className="btn-ink h-10 min-h-0 px-4"><Plus size={17} />Book a dog</Link>
        </span>
      </div>
      <p className="mb-4 mt-1 text-ink-soft">Every dog, past and present. Tap one for everything about it.</p>
      <ChatFilters base="/a/dogs" q={q} t={t} f={tab} placeholder="Search dog, client, email, trainer or deal ID" trainers={trainers.map((x) => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name))} />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((x) => <Link key={x.key} prefetch={false} href={link(x.key)} className={`rounded-full px-3.5 py-1.5 text-small font-semibold ${x.key === tab && !standby ? "bg-ink text-white" : "border border-line bg-white"}`}>{x.label}</Link>)}
        <Link prefetch={false} href={link("standby")} className={`rounded-full px-3.5 py-1.5 text-small font-semibold ${standby ? "bg-ink text-white" : "border border-line bg-white"}`}>Standby</Link>
      </div>
      {!standby && pocs.length > 0 && (
        <div className="-mt-2 mb-3 flex flex-wrap items-center gap-1.5 text-small">
          <span className="text-ink-soft">POC:</span>
          {["", ...pocs].map((x) => <Link key={x || "all"} prefetch={false} href={`/a/dogs?${params(tab, x)}`} className={`rounded-full px-3 py-1 font-semibold ${poc.toLowerCase() === x.toLowerCase() ? "bg-ink text-white" : "border border-line bg-white text-ink-soft"}`}>{x || "All"}</Link>)}
        </div>
      )}
      {!standby && rows.length > 0 && <p className="mb-2 text-caption text-ink-faint">I intake · W weekly · H handover · F follow-ups. Green in · amber late or asked · red missing · blue booked · outline not due · grey before the app.</p>}
      {standby ? <StandbyList q={q} /> : rows.length ? <BookingHistory rows={rows} role="admin" showTrainer={!t} ready={readyBadges} /> : <Empty title={q || t ? "No dogs match." : "Nothing here."} />}
      {!standby && more && <p className="mt-3 text-center text-small text-ink-soft">Showing the first {rows.length}. Search to narrow it down.</p>}
    </>
  );
}
