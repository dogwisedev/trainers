import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { listStandby } from "@/lib/standby";
import { DealDecision } from "@/components/DealDecision";
import { short } from "@/lib/dates";

// Dogs → Standby: every Closed Won deal with Client Status = Standby in HubSpot (parked, or a postponed training),
// with the note, the reminder, and Book now / Update standby / Cancelled on each.
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export async function StandbyList({ q }: { q: string }) {
  const { rows, error } = await listStandby();
  const needle = q.toLowerCase();
  const list = needle ? rows.filter((r) => `${r.name} ${r.dogs} ${r.zip} ${r.owner} ${r.dealId}`.toLowerCase().includes(needle)) : rows;
  if (error) return <p className="panel p-4 text-body text-heart">{error}</p>;
  const total = list.reduce((n, r) => n + r.amount, 0), paid = list.reduce((n, r) => n + (r.paid || 0), 0);
  const days = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(`${iso}T12:00:00Z`)) / 864e5)) : null);
  return (
    <>
      <p className="mb-3 text-body text-ink-soft"><b className="text-ink">{list.length}</b> on standby · {money(total)} sold · {money(paid)} paid. From HubSpot (Client Status = Standby), with the app&apos;s notes and reminders.</p>
      {!list.length && <p className="panel p-4 text-body text-ink-soft">Nothing on standby.</p>}
      <ul className="space-y-3">
        {list.map((r) => {
          const since = days(r.since || r.wonOn);
          return (
            <li key={r.dealId} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold">{r.name}{r.dogs ? <span className="font-normal text-ink-soft"> · {r.dogs}</span> : null}</p>
                  <p className="text-small text-ink-soft">{[r.zip && `ZIP ${r.zip}`, r.owner, r.wonOn && `won ${short(r.wonOn)}`, r.source === "postponed" ? "postponed" : null].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="text-right text-small tabular-nums">
                  <p className="font-bold">{money(r.amount)}</p>
                  <p className="text-ink-soft">{r.paid != null ? `${money(r.paid)} paid` : ""}</p>
                </div>
              </div>
              <p className="mt-2 text-small">{r.note ? <>{r.note}</> : <span className="text-ink-faint">No note yet.</span>}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-caption text-ink-soft">
                <span className={since != null && since > 60 ? "font-semibold text-heart" : ""}>{since != null ? `${since} days` : ""}{r.since ? " on standby" : " since won"}</span>
                <span>{r.remindOn ? `Reminder ${short(r.remindOn)}` : "No reminder"}</span>
                <a href={r.hubspot} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-semibold underline">HubSpot<ExternalLink size={12} /></a>
              </p>
              <DealDecision dealId={r.dealId} bookHref={`/a/bookings/new?deal=${r.dealId}`} note={r.note} remindOn={r.remindOn} onStandby />
            </li>
          );
        })}
      </ul>
    </>
  );
}
