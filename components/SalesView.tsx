import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { Seller } from "@/lib/sales";
import { Avatar, Empty } from "@/components/ui";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });
export const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Month chips, totals, and each seller's sales. Admins see everyone; a sales person sees their own. */
export function SalesView({ month, months, base, sellers, total, remaining, count, admin }: { month: string; months: string[]; base: string; sellers: Seller[]; total: number; remaining: number; count: number; admin: boolean }) {
  return (
    <>
      <nav className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Month">
        {months.map((m) => <Link key={m} href={`${base}?m=${m}`} aria-current={m === month ? "page" : undefined} className={`chip shrink-0 ${m === month ? "chip-on" : ""}`}>{monthLabel(m)}</Link>)}
      </nav>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="panel p-4"><p className="text-[13px] font-semibold text-ink-soft">Sales</p><p className="mt-1 text-[26px] font-extrabold leading-none">{usd(total)}</p><p className="mt-1 text-[13px] text-ink-faint">{count} program{count === 1 ? "" : "s"}</p></div>
        <div className="panel p-4"><p className="text-[13px] font-semibold text-ink-soft">Remaining balance</p><p className={`mt-1 text-[26px] font-extrabold leading-none ${remaining ? "text-heart" : ""}`}>{usd(remaining)}</p><p className="mt-1 text-[13px] text-ink-faint">still to be paid</p></div>
      </div>
      {sellers.length ? sellers.map((s) => (
        <section key={s.ownerId || s.name} className="mt-6">
          {admin && (
            <h2 className="group-title"><Avatar name={s.name} size={30} />{s.name}<span className="count">{s.count}</span>
              <span className="ml-auto text-[14px] font-bold">{usd(s.amount)}{s.remaining > 0 && <span className="ml-2 font-semibold text-heart">{usd(s.remaining)} due</span>}</span></h2>
          )}
          <ul className="panel divide-y divide-line">
            {s.sales.map((x) => (
              <li key={x.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3.5">
                <div className="min-w-[55%] flex-1">
                  <p className="font-semibold">{x.client || "Client"}</p>
                  <p className="text-[13px] text-ink-soft">{[x.program, x.closedOn ? `won ${new Date(`${x.closedOn}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "from the Monies sheet"].filter(Boolean).join(", ")}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{usd(x.amount)}</p>
                  <p className={`text-[13px] ${x.remaining ? "font-semibold text-heart" : "text-ink-faint"}`}>{x.remaining === null ? "" : x.remaining ? `${usd(x.remaining)} due` : "Paid"}</p>
                </div>
                {admin && (x.dealId || x.link) && (
                  <div className="flex w-full gap-2">
                    {x.dealId && <a href={`https://app.hubspot.com/contacts/21869370/record/0-3/${x.dealId}`} target="_blank" rel="noopener" className="btn-ghost h-8 min-h-0 px-2.5 text-[12px]">HubSpot<ExternalLink size={12} /></a>}
                    {x.link && x.remaining ? <a href={x.link} target="_blank" rel="noopener" className="btn-ghost h-8 min-h-0 px-2.5 text-[12px]">Balance link<ExternalLink size={12} /></a> : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )) : <div className="mt-6"><Empty title={`No sales in ${monthLabel(month)} yet.`}>Closed Won deals show here once they&apos;re booked in the app.</Empty></div>}
    </>
  );
}
