import Link from "next/link";
import { requireRole } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { readinessFor } from "@/lib/pretraining";
import { etParts } from "@/lib/chatRules";
import { addDays, short } from "@/lib/dates";
import { Empty, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";
type Row = { id: string; dog_name: string | null; client_name: string; start_date: string; end_date: string; hubspot_deal_id: string | null; trainers: { name: string } | null };

// Admin: every dog starting in the next 60 days, and what's still missing. Vaccine records waiting for a check come first.
export default async function ReadyPage({ searchParams }: { searchParams: { all?: string } }) {
  await requireRole("admin");
  const today = etParts(new Date()).date, horizon = addDays(today, 60), week = addDays(today, 7);
  const sb = isDemo() ? null : serviceClient();
  const { data } = sb ? await sb.from("bookings").select("id, dog_name, client_name, start_date, end_date, hubspot_deal_id, trainers(name)").not("hubspot_deal_id", "is", null).neq("status", "cancelled").gte("start_date", today).lte("start_date", horizon).order("start_date") : { data: [] };
  const rows = (data || []) as unknown as Row[];
  const [ready, { data: chats }] = await Promise.all([
    readinessFor(rows.map((r) => r.id)),
    sb ? sb.from("chats").select("id, deal_key").in("deal_key", [...new Set(rows.map((r) => r.hubspot_deal_id!))]).eq("status", "open") : Promise.resolve({ data: [] })
  ]);
  const chatOf = new Map(((chats || []) as { id: string; deal_key: string }[]).map((c) => [c.deal_key, c.id]));
  const link = (r: Row) => (chatOf.get(r.hubspot_deal_id!) ? `/a/chats/${chatOf.get(r.hubspot_deal_id!)}/profile?dog=${r.id}` : null);
  const toCheck = rows.filter((r) => ready.get(r.id)?.dog.vaccine.toCheck);
  const showAll = searchParams.all === "1";
  const list = rows.filter((r) => showAll || !ready.get(r.id)?.ready.ready);
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Before training</h1>
      <p className="mb-4 mt-1 text-ink-soft">Dogs starting in the next 60 days and what&apos;s still missing. From a week before the start, anything missing also opens a &ldquo;Not ready&rdquo; incident. Checked against HubSpot every 30 minutes.</p>

      {toCheck.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-ink-soft">Vaccine records to check <span className="opacity-70">{toCheck.length}</span></h2>
          <ul className="panel divide-y divide-line">
            {toCheck.map((r) => (
              <li key={r.id} className="flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1"><p className="truncate font-bold">{ready.get(r.id)?.dog.name || r.dog_name}</p><p className="truncate text-[13px] text-ink-soft">{r.client_name}, starts {short(r.start_date)}</p></div>
                {link(r) && <Link href={`${link(r)}#vaccines`} className="btn-ink h-9 min-h-0 px-3 text-[13px]">Check</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-3 flex gap-2">
        {[["", "Not ready"], ["1", "All"]].map(([k, l]) => <Link key={k} href={k ? "/a/ready?all=1" : "/a/ready"} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${(k === "1") === showAll ? "bg-ink text-white" : "border border-line bg-white"}`}>{l}</Link>)}
      </div>
      {list.length ? (
        <ul className="panel divide-y divide-line">
          {list.map((r) => {
            const x = ready.get(r.id), soon = r.start_date <= week;
            return (
              <li key={r.id} className="flex items-start gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{x?.dog.name || r.dog_name || "Dog"} <span className="font-normal text-ink-soft">{r.client_name}, {r.trainers?.name || "no trainer"}</span></p>
                  <p className={`text-[13px] ${soon ? "font-semibold text-heart" : "text-ink-soft"}`}>Starts {short(r.start_date)}</p>
                  {x ? (x.ready.ready ? <Pill>{x.dog.cleared ? `OK to start (${x.dog.cleared.by})` : "Ready"}</Pill> : (
                    <div className="mt-1 flex flex-wrap gap-1.5">{x.ready.missing.map((i) => <Pill key={i.key} tone={i.who === "admin" ? "line" : "heart"}>{i.label}</Pill>)}</div>
                  )) : <p className="text-[13px] text-ink-faint">Not checked against HubSpot yet.</p>}
                </div>
                {link(r) ? <Link href={link(r)!} className="btn-ghost h-9 min-h-0 px-3 text-[13px]">Open</Link> : <span className="text-[12px] text-ink-faint">No chat</span>}
              </li>
            );
          })}
        </ul>
      ) : <Empty title={showAll ? "No dogs starting in the next 60 days." : "Everyone starting soon is ready."} />}
    </>
  );
}
