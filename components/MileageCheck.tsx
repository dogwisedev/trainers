import { ExternalLink } from "lucide-react";
import { Pill } from "@/components/ui";
import { CheckRoutesButton } from "@/components/CheckRoutesButton";
import { TRIP_LABEL } from "@/lib/payroll";
import type { MileageRow } from "@/lib/tripRoutes";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const SOURCE: Record<string, string> = { address: "address", profile: "map point on their profile", zip: "ZIP centre" };

/** On the payslip: each trip's declared miles next to the driving route, with a Google Maps link to check it by hand. */
/** onSlip: each trip's pay line amount on this payslip, or null when the trip isn't on it (shown as a warning). */
export function MileageCheck({ rows, payslipId, setUp, onSlip }: { rows: MileageRow[]; payslipId: string; setUp: boolean; onSlip?: Record<string, number | null> }) {
  if (!rows.length) return null;
  const missing = onSlip ? rows.filter((r) => onSlip[r.tripId] === null).length : 0;
  const flagged = rows.filter((r) => r.check.over || r.check.paid).length, unchecked = rows.filter((r) => !r.route).length;
  return (
    <section className="panel overflow-hidden" aria-labelledby="miles-title">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line bg-paper/60 px-4 py-3">
        <div className="min-w-0">
          <h2 id="miles-title" className="text-lead font-extrabold">Mileage check</h2>
          <p className="text-small text-ink-soft">{flagged ? `${flagged} trip${flagged > 1 ? "s" : ""} to look at.` : "Nothing to look at."} Declared miles are round trips; the route is doubled to match.</p>
          {missing > 0 && <p className="mt-1 text-small font-semibold text-heart">{missing} trip{missing > 1 ? "s aren't" : " isn't"} on the payslip yet. Reload this page; if it&apos;s still missing, add a Route line below.</p>}
        </div>
        <CheckRoutesButton payslipId={payslipId} label={unchecked ? `Check ${unchecked} now` : "Check again"} />
      </div>
      {!setUp && <p className="border-b border-line bg-biscuit-wash px-4 py-2.5 text-small text-warn">FreeRoute isn&apos;t set up (FREEROUTE_API_KEY), so these are estimates: straight line + 25% for roads.</p>}
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const c = r.check, route = r.route;
          return (
            <li key={r.tripId} className={`p-4 ${c.over ? "bg-heart-wash/50" : ""}`}>
              <p className="font-bold leading-snug">{TRIP_LABEL[r.kind]} {day(r.date)}<span className="font-normal text-ink-soft"> · {r.dog || "Dog"}{r.client ? ` (${r.client})` : ""}</span></p>
              <p className="mt-1 text-body tabular-nums">
                Declared <b>{r.declared} mi</b>
                {" · "}{c.round != null ? <>{route?.method === "estimate" ? "estimate" : "route"} <b>{c.round} mi</b> round trip</> : <span className="text-ink-faint">route not checked yet</span>}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {c.over && <Pill tone="heart">Over the route by {c.overBy} mi</Pill>}
                {c.paid && <Pill tone="biscuit">Paid mileage: check it</Pill>}
                {!c.over && !c.paid && c.round != null && <Pill tone="mint">Matches the route</Pill>}
                {onSlip && onSlip[r.tripId] === null && <Pill tone="heart">Not on the payslip</Pill>}
                {onSlip && onSlip[r.tripId] != null && <Pill tone="line">On the payslip: ${onSlip[r.tripId]!.toFixed(2)}</Pill>}
                {route?.google_url && <a href={route.google_url} target="_blank" rel="noopener" className="btn-ghost h-9 min-h-0 px-3 text-small">Check on Google Maps<ExternalLink size={13} /></a>}
              </div>
              {route && (route.from_label || route.note) && (
                <p className="mt-2 text-caption text-ink-faint">
                  {route.from_label && route.to_label ? `From ${route.from_label} (${SOURCE[route.from_source || ""] || "address"}) to ${route.to_label}.` : ""}{route.note ? ` ${route.note}` : ""}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-4 py-2.5 text-caption text-ink-faint">Flags: more than 5% or 15 miles over the route, or any trip that earns mileage pay. Pay is worked out from the declared miles either way; change the line below if it&apos;s wrong.</p>
    </section>
  );
}
