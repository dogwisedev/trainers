import Link from "next/link";
import type { HistoryRow } from "@/lib/history";
import { short } from "@/lib/dates";
import { Pill } from "@/components/ui";

const range = (a: string, b: string) => `${short(a)} to ${short(b)}`;
const repLabel = (r: HistoryRow["reports"][number]) => (r.kind === "intake" ? "Intake" : r.kind === "handover" ? "Handover" : `Week ${r.week_number}`);

/** A list of bookings with links to the chat, the Dog profile and the forms. Admin and trainer versions. */
export function BookingHistory({ rows, role, showTrainer = true, ready = {} }: { rows: HistoryRow[]; role: "admin" | "trainer"; showTrainer?: boolean; ready?: Record<string, { missing: number; cleared: boolean }> }) {
  const base = role === "admin" ? "/a" : "/t";
  return (
    <ul className="panel divide-y divide-line">
      {rows.map((b) => {
        const chatOk = !!b.chat;
        return (
          <li key={b.id} className="p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold">{role === "admin" ? <Link href={`/a/dogs/${b.id}`} className="hover:underline">{b.dog_name || "Dog"}</Link> : b.dog_name || "Dog"} <span className="font-normal text-ink-soft">{b.client_name}{showTrainer && b.trainers?.name ? `, ${b.trainers.name}` : ""}</span></p>
                <p className="text-[13px] text-ink-soft">{range(b.start_date, b.end_date)}, {b.program || `${b.weeks}-week`}{b.extra_days ? ` + ${b.extra_days} day${b.extra_days > 1 ? "s" : ""}` : ""}{b.rehab ? ", rehab" : ""}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {ready[b.id] && <Pill tone={ready[b.id].missing ? "heart" : "mint"}>{ready[b.id].missing ? `${ready[b.id].missing} missing` : ready[b.id].cleared ? "OK to start" : "Ready"}</Pill>}
                {b.status === "cancelled" && <Pill tone="heart">Cancelled</Pill>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
              {role === "admin" && <Link href={`/a/dogs/${b.id}`} className="btn-ink h-8 min-h-0 px-2.5 text-[13px]">Open</Link>}
              {role === "trainer" && chatOk && <Link href={`${base}/chats/${b.chat!.id}`} className="btn-ghost h-8 min-h-0 px-2.5 text-[13px]">Chat{b.chat!.status === "closed" ? " (closed)" : ""}</Link>}
              {role === "trainer" && b.chat && b.hubspot_deal_id && <Link href={`${base}/chats/${b.chat.id}/profile?dog=${b.id}`} className="btn-ghost h-8 min-h-0 px-2.5 text-[13px]">Dog profile</Link>}
              {role === "trainer" && b.status !== "cancelled" && <Link href={`/t/followup?b=${b.id}`} className="btn-ghost h-8 min-h-0 px-2.5 text-[13px]">Log follow-up</Link>}
              {role === "trainer" && b.reports.map((r) => <Link key={r.id} href={`${base}/reports/${r.id}`} className="rounded-full border border-line bg-white px-2.5 py-1 font-semibold hover:bg-mint-wash">{repLabel(r)}</Link>)}
              {role === "admin" && b.hubspot_deal_id && <a href={`https://app.hubspot.com/contacts/21869370/record/0-3/${b.hubspot_deal_id}`} target="_blank" rel="noopener" className="px-1 text-ink-soft underline">HubSpot</a>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
