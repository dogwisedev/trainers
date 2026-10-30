import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { SalesInsights } from "@/lib/salesInsights";

// The comparison band on the Sales screen: this month against last year and last month, the 13-month strip, each
// salesperson, what sells, discounts, days to close, lost reasons, payment plans.
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
function Delta({ now, before, pct = true }: { now: number; before: number; pct?: boolean }) {
  if (!before) return null;
  const d = now - before; if (!d) return <span className="text-small text-ink-faint">same</span>;
  const up = d > 0, text = pct ? `${up ? "+" : "−"}${Math.abs(Math.round((d / before) * 100))}%` : `${up ? "+" : "−"}${Math.abs(d)}`;
  return <span className={`inline-flex items-center gap-0.5 text-small font-semibold ${up ? "text-fern" : "text-heart"}`}>{up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{text}</span>;
}
const Big = ({ n, amount }: { n: number; amount: number }) => <p className="mt-1 text-[28px] font-extrabold leading-none tabular-nums">{n} <span className="text-body font-semibold text-ink-soft">· {money(amount)}</span></p>;

function Strip({ s }: { s: SalesInsights }) {
  const max = Math.max(1, ...s.strip.map((b) => Math.max(b.n, b.lyN))), w = 100, h = 40, n = s.strip.length, bw = w / n;
  return (
    <div className="panel p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-caption text-ink-soft">
        <span>Sales per month · <span className="inline-block h-2.5 w-2.5 rounded-sm bg-lav align-[-1px]" /> last 13 months · <span className="inline-block h-2.5 w-2.5 rounded-sm bg-line align-[-1px]" /> the same months a year earlier</span>
        <span className="tabular-nums">{s.strip.reduce((k, b) => k + b.n, 0)} vs {s.strip.reduce((k, b) => k + b.lyN, 0)} a year earlier</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-28 w-full" aria-hidden>
        {s.strip.map((b, i) => <g key={b.month}><rect x={i * bw + bw * 0.1} y={h - (b.lyN / max) * (h - 2)} width={bw * 0.8} height={(b.lyN / max) * (h - 2)} className="fill-line" /><rect x={i * bw + bw * 0.28} y={h - (b.n / max) * (h - 2)} width={bw * 0.44} height={(b.n / max) * (h - 2)} className={i === n - 1 ? "fill-fern" : "fill-lav"} rx="0.6" /></g>)}
      </svg>
      <div className="mt-1 grid text-[10px] text-ink-faint md:text-caption" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>{s.strip.map((b) => <span key={b.month} className="truncate text-center">{b.label}</span>)}</div>
      <p className="mt-2 text-caption text-ink-faint">The green bar is the month you&apos;re looking at.</p>
    </div>
  );
}

export function SalesInsightsView({ s, admin }: { s: SalesInsights; admin: boolean }) {
  const toDateNote = s.current ? `by the ${s.dayOfMonth}${["th", "st", "nd", "rd"][(s.dayOfMonth % 10 > 3 || Math.floor(s.dayOfMonth / 10) === 1) ? 0 : s.dayOfMonth % 10]}` : "whole month";
  return (
    <div className="mt-5 space-y-5">
      <section className="grid gap-3 md:grid-cols-3">
        <div className="panel p-4">
          <p className="text-small font-semibold text-ink-soft">{s.label}{s.current ? " so far" : ""} <Delta now={s.thisMonth.amount} before={s.lastYearToDate.amount} /></p>
          <Big n={s.thisMonth.n} amount={s.thisMonth.amount} />
          <p className="mt-2 text-small text-ink-soft">Same month last year, {toDateNote}: <b>{s.lastYearToDate.n}</b> ({money(s.lastYearToDate.amount)}). The whole month: <b>{s.lastYearFull.n}</b> ({money(s.lastYearFull.amount)}).</p>
        </div>
        <div className="panel p-4">
          <p className="text-small font-semibold text-ink-soft">Against last month <Delta now={s.thisMonth.amount} before={s.lastMonthToDate.amount} /></p>
          <Big n={s.lastMonthToDate.n} amount={s.lastMonthToDate.amount} />
          <p className="mt-2 text-small text-ink-soft">Last month {toDateNote}. The whole of last month: <b>{s.lastMonthFull.n}</b> ({money(s.lastMonthFull.amount)}).</p>
        </div>
        <div className="panel p-4">
          <p className="text-small font-semibold text-ink-soft">What last year says about {s.nextMonthLY.label}</p>
          <Big n={s.nextMonthLY.n} amount={s.nextMonthLY.amount} />
          <p className="mt-2 text-small text-ink-soft">Closed Won in {s.nextMonthLY.label} last year. Not a forecast, just what happened.</p>
        </div>
      </section>
      <Strip s={s} />
      <section className="grid gap-3 md:grid-cols-4">
        <div className="panel p-4"><p className="text-small font-semibold text-ink-soft">Leads <Delta now={s.leads.month} before={s.leads.lastYear} /></p><p className="mt-1 text-[26px] font-extrabold leading-none tabular-nums">{s.leads.month.toLocaleString("en-US")}</p><p className="mt-1 text-small text-ink-soft">{s.leads.lastYear.toLocaleString("en-US")} same month last year</p></div>
        <div className="panel p-4"><p className="text-small font-semibold text-ink-soft">Conversion {s.conversion.lastYear ? <Delta now={s.conversion.month || 0} before={s.conversion.lastYear} /> : null}</p><p className="mt-1 text-[26px] font-extrabold leading-none tabular-nums">{s.conversion.month == null ? "–" : `${s.conversion.month}%`}</p><p className="mt-1 text-small text-ink-soft">{s.conversion.lastYear != null ? `${s.conversion.lastYear}% last year` : "sales ÷ leads created"}</p></div>
        <div className="panel p-4"><p className="text-small font-semibold text-ink-soft">Days to close</p><p className="mt-1 text-[26px] font-extrabold leading-none tabular-nums">{s.closeDays.month ?? "–"}</p><p className="mt-1 text-small text-ink-soft">median{s.closeDays.lastYear != null ? ` · ${s.closeDays.lastYear} last year` : ""}</p></div>
        <div className="panel p-4"><p className="text-small font-semibold text-ink-soft">Discounting</p><p className="mt-1 text-[26px] font-extrabold leading-none tabular-nums">{s.discount.month == null ? "–" : `${s.discount.month}%`}</p><p className="mt-1 text-small text-ink-soft">average off, on {s.discount.share ?? 0}% of deals{s.discount.lastYear != null ? ` · ${s.discount.lastYear}% last year` : ""}</p></div>
      </section>
      <section className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div>
          <h2 className="mb-2 text-lead font-extrabold">Salespeople, {s.label}</h2>
          <ul className="panel divide-y divide-line">
            {s.people.map((p) => (
              <li key={p.id} className="p-3.5">
                <div className="flex items-center justify-between gap-2"><b className="min-w-0 truncate">{p.name}</b><span className="shrink-0 text-body font-semibold tabular-nums">{p.month.n} · {money(p.month.amount)} <Delta now={p.month.amount} before={p.lastYear.amount} /></span></div>
                <p className="mt-0.5 text-small tabular-nums text-ink-soft">Last month {p.last.n} ({money(p.last.amount)}) · same month last year {p.lastYear.n} ({money(p.lastYear.amount)}){p.avgDeal ? ` · avg deal ${money(p.avgDeal)}` : ""}{p.closeDays != null ? ` · ${p.closeDays} days to close` : ""}{p.discount != null ? ` · ${p.discount}% off avg` : ""}{p.calls ? ` · ${p.calls.toLocaleString("en-US")} calls${p.perSale ? `, ${p.perSale} per sale` : ""}` : ""}</p>
              </li>
            ))}
            {!s.people.length && <li className="px-4 py-3 text-small text-ink-soft">Nothing yet this month.</li>}
          </ul>
        </div>
        <div className="space-y-5">
          <div>
            <h2 className="mb-2 text-lead font-extrabold">What sells</h2>
            <ul className="panel divide-y divide-line">
              {s.programs.slice(0, 8).map((x) => <li key={x.program} className="flex items-center justify-between gap-2 px-4 py-2.5 text-small"><span className="min-w-0 truncate font-semibold">{x.program}</span><span className="shrink-0 tabular-nums text-ink-soft">{x.n} ({money(x.amount)}) · {x.lyN} last year</span></li>)}
              {!s.programs.length && <li className="px-4 py-3 text-small text-ink-soft">No sales yet this month.</li>}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 text-lead font-extrabold">Lost this month</h2>
            <ul className="panel divide-y divide-line">
              {s.lost.map((x) => <li key={x.reason} className="flex items-center justify-between gap-2 px-4 py-2.5 text-small"><span className="min-w-0 truncate">{x.reason}</span><span className="shrink-0 tabular-nums text-ink-soft">{x.n} · {money(x.amount)}</span></li>)}
              {!s.lost.length && <li className="px-4 py-3 text-small text-ink-soft">Nothing marked lost this month.</li>}
            </ul>
            {(s.planLost.n > 0 || (s.failed && s.failed.n > 0) || s.refunds.n > 0) && (
              <p className="mt-2 text-small text-ink-soft">
                {s.planLost.n > 0 && <>{s.planLost.n} not approved for a payment plan ({money(s.planLost.amount)}); worth offering two smaller plans. </>}
                {s.failed && s.failed.n > 0 && <>{s.failed.n} customers&apos; last card payment failed ({money(s.failed.amount)}). </>}
                {s.refunds.n > 0 && <>{s.refunds.n} refund{s.refunds.n > 1 ? "s" : ""} ({money(s.refunds.amount)}).</>}
              </p>
            )}
          </div>
        </div>
      </section>
      <p className="text-caption text-ink-faint">Months are by close date, Eastern time. Figures are from HubSpot and refreshed hourly{admin ? ", or with Refresh from HubSpot" : ""}.{s.notes.length ? ` ${s.notes.join(" ")}` : ""}</p>
    </div>
  );
}
