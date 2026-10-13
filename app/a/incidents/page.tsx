import Link from "next/link";
import { requireRole } from "@/lib/data";
import { listIncidents } from "@/lib/chatData";
import { IncidentList } from "@/components/IncidentList";
import { Empty } from "@/components/ui";

export const maxDuration = 60; // closing a chat saves to Drive and emails the client

export default async function Incidents({ searchParams }: { searchParams: { f?: string } }) {
  await requireRole("admin");
  const resolved = searchParams.f === "resolved";
  const [live, done] = await Promise.all([listIncidents(false), resolved ? listIncidents(true) : Promise.resolve([])]);
  const list = resolved ? done : live;
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Incidents</h1>
      <p className="mb-4 mt-1 text-ink-soft">Things that need a person: chats (a trainer who hasn&apos;t posted, a client waiting, a chat ready to close), forms sent without photos, and bookings (overbooked, changed or cancelled in HubSpot). Every admin is emailed when one opens; money matters go to info@ too. Most clear themselves once handled.</p>
      <div className="mb-4 flex gap-2">
        <Link href="/a/incidents" className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${!resolved ? "bg-ink text-white" : "border border-line bg-white"}`}>Open <span className="opacity-70">{live.length}</span></Link>
        <Link href="/a/incidents?f=resolved" className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${resolved ? "bg-ink text-white" : "border border-line bg-white"}`}>Resolved</Link>
      </div>
      {list.length ? <IncidentList incidents={list} resolved={resolved} /> : <Empty title={resolved ? "Nothing resolved yet." : "All clear."}>{resolved ? "" : "Nothing needs attention right now."}</Empty>}
    </>
  );
}
