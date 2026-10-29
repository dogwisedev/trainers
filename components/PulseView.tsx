import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Info } from "lucide-react";
import { Pill } from "@/components/ui";
import { PulseRefresh } from "@/components/PulseRefresh";
import type { Card, OfficeView, Pulse, SalesView, Tile, TrainerRow, View } from "@/lib/pulse";
import { PRESETS } from "@/lib/pulse";
import { minutesLabel } from "@/lib/pulseMath";
import { US_COLS, US_ROWS, US_TILES } from "@/lib/usTiles";

// Pulse: three screens switched like the Chats page.
//  Office: clients and the link to trainers, is it going smoothly (Pedro's weekly list is here).
//  Trainers: how each trainer is doing and earning.  Sales: leads, conversion, cost, last year, each salesperson.
// Mobile first: cards scroll sideways, tiles two across, the map is a grid of state squares that fits a phone.

type Q = { r?: string; from?: string; to?: string; v?: string; state?: string };
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const VIEWS: { key: View; label: string }[] = [{ key: "office", label: "Office" }, { key: "trainers", label: "Trainers" }, { key: "sales", label: "Sales" }];
const href = (q: Q, patch: Partial<Q>) => { const p = new URLSearchParams(); const all = { ...q, ...patch }; for (const k of ["v", "r", "from", "to", "state"] as const) if (all[k]) p.set(k, all[k]!); const s = p.toString(); return s ? `/a/pulse?${s}` : "/a/pulse"; };

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-7" />;
  const max = Math.max(1, ...values), w = 100, h = 28;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 4)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-7 w-full text-lav" aria-hidden>
      <polygon points={`0,${h} ${line} ${w},${h}`} fill="currentColor" opacity="0.15" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Delta({ t }: { t: Tile }) {
  if (!t.delta.text || t.delta.up === null) return t.delta.text ? <span className="text-small text-ink-faint">{t.delta.text}</span> : null;
  const good = t.good ? (t.good === "up") === t.delta.up : null;
  const cls = good === null ? "text-ink-soft" : good ? "text-fern" : "text-heart";
  return <span className={`inline-flex items-center gap-0.5 text-small font-semibold ${cls}`}>{t.delta.up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{t.delta.text}</span>;
}

/** A big number. Tap it to open the list behind it; "How it's worked out" folds out underneath. */
function TileCard({ t }: { t: Tile }) {
  const num = <p className="mt-1 text-[30px] font-extrabold leading-none tabular-nums tracking-tight md:text-[36px]">{t.value}</p>;
  return (
    <div className="panel flex flex-col p-4">
      <div className="flex items-start justify-between gap-2"><p className="text-small font-semibold text-ink-soft">{t.label}</p><Delta t={t} /></div>
      {t.to ? <Link prefetch={false} href={t.to} className="group inline-flex items-baseline gap-1 hover:underline">{num}<ChevronRight size={16} className="text-ink-faint group-hover:text-ink" /></Link> : num}
      <p className="mt-1.5 text-small text-ink-soft">{t.sub}</p>
      <div className="mt-2">{t.spark.length ? <Spark values={t.spark} /> : <div className="h-7" />}</div>
      <details className="group mt-1">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-caption text-ink-faint [&::-webkit-details-marker]:hidden"><Info size={12} />How it&apos;s worked out{t.n ? ` · ${t.n}` : ""}</summary>
        <p className="mt-1 text-caption text-ink-soft">{t.how}</p>
      </details>
    </div>
  );
}

function CardView({ c }: { c: Card }) {
  const tone = c.tone === "heart" ? "border-heart/30 bg-heart-wash" : c.tone === "biscuit" ? "border-biscuit/40 bg-biscuit-wash" : "border-mint-deep/30 bg-mint-wash";
  const text = c.tone === "heart" ? "text-heart" : c.tone === "biscuit" ? "text-warn" : "text-fern";
  const inner = <><p className={`text-body font-bold leading-snug ${text}`}>{c.title}</p><p className="mt-1 text-small text-ink-soft">{c.evidence}</p>{c.action && <p className={`mt-2 inline-flex items-center gap-1 text-small font-semibold ${text}`}>{c.action}<ChevronRight size={14} /></p>}</>;
  const cls = `block w-[82vw] shrink-0 snap-start rounded-2xl border p-4 md:w-auto ${tone}`;
  return c.href ? <Link prefetch={false} href={c.href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

const Bar = ({ v, tone = "bg-lav" }: { v: number | null; tone?: string }) => <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }} /></div>;
const H = ({ children, n }: { children: React.ReactNode; n?: number }) => <h2 className="mb-2 text-lead font-extrabold">{children}{n !== undefined && <span className="ml-2 text-body font-semibold text-ink-soft">{n}</span>}</h2>;
const Empty = ({ children }: { children: React.ReactNode }) => <li className="px-4 py-3 text-small text-ink-soft">{children}</li>;

// ── Office ──
function Office({ o }: { o: OfficeView }) {
  const joinedPct = o.chats ? Math.round((o.joined / o.chats) * 100) : 0;
  return (
    <>
      <section className="mb-6 grid grid-cols-3 gap-2 md:grid-cols-6">
        {([["To do", o.counts.todo, "/a"], ["Need a person today", o.counts.now, "/a#todo-now"], ["Forms to check", o.counts.toReview, "/a#todo-week"], ["Forms late", o.counts.late, "/a#todo-week"], ["Won, not booked", o.counts.notBooked, "/a#todo-now"], ["Not signed in", o.counts.notSignedIn, "/a/trainers#signin"]] as [string, number, string][]).map(([l, n, h]) => (
          <Link key={l} prefetch={false} href={h} className="panel p-3 hover:bg-paper/60"><p className="text-caption font-semibold text-ink-soft">{l}</p><p className={`mt-1 text-[24px] font-extrabold leading-none tabular-nums ${n ? "" : "text-ink-faint"}`}>{n}</p></Link>
        ))}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <H>Clients</H>
          <div className="panel p-4">
            <p className="text-[26px] font-extrabold leading-none tabular-nums">{joinedPct}% <span className="text-body font-semibold text-ink-soft">of clients with a dog in care have opened their chat</span></p>
            <div className="mt-3"><Bar v={joinedPct} tone="bg-fern" /></div>
            <p className="mt-2 text-small text-ink-soft">{o.joined} of {o.chats}. <Link prefetch={false} href="/a/chats?j=no" className="font-semibold underline">See who hasn&apos;t</Link></p>
          </div>
          <H n={o.silent24.length}>No word from Dogwise for 24 h+</H>
          <ul className="panel divide-y divide-line">
            {o.silent24.slice(0, 10).map((x) => <li key={x.href}><Link prefetch={false} href={x.href} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-paper/60"><span className="min-w-0 truncate"><b>{x.dog}</b> <span className="text-ink-soft">· {x.client} · {x.trainer}</span></span><span className={`shrink-0 text-small font-semibold tabular-nums ${x.hours >= 48 ? "text-heart" : "text-warn"}`}>{x.hours} h</span></Link></li>)}
            {!o.silent24.length && <Empty>Every client has heard from Dogwise in the last 24 hours.</Empty>}
          </ul>
          <H n={o.waitingClients.length}>Clients below the promised frequency</H>
          <ul className="panel divide-y divide-line">
            {o.waitingClients.slice(0, 10).map((x) => <li key={x.href}><Link prefetch={false} href={x.href!} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-paper/60"><span className="min-w-0 truncate"><b>{x.client}</b> <span className="text-ink-soft">· {x.dog}</span></span><span className="shrink-0 text-small font-semibold tabular-nums text-heart">{x.n}× waiting</span></Link></li>)}
            {!o.waitingClients.length && <Empty>No client was left waiting twice in this range.</Empty>}
          </ul>
          <H n={o.balances.length}>Balance still owed, start coming up</H>
          <ul className="panel divide-y divide-line">
            {o.balances.slice(0, 8).map((x, i) => <li key={i}>{x.href ? <Link prefetch={false} href={x.href} className="block px-4 py-2.5 text-body hover:bg-paper/60">{x.text}</Link> : <span className="block px-4 py-2.5 text-body">{x.text}</span>}</li>)}
            {!o.balances.length && <Empty>Nobody starting soon still owes a balance.</Empty>}
          </ul>
        </section>
        <section>
          <H n={o.slowTrainers.length}>Trainers with repeated comms alerts</H>
          <ul className="panel divide-y divide-line">
            {o.slowTrainers.map((x) => <li key={x.href}><Link prefetch={false} href={x.href} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-paper/60"><b>{x.name}</b><span className="text-small font-semibold tabular-nums text-heart">{x.alerts} alerts</span></Link></li>)}
            {!o.slowTrainers.length && <Empty>No trainer had 3+ alerts in this range.</Empty>}
          </ul>
          <H n={o.lateForms.reduce((n, x) => n + x.n, 0)}>Forms missing, by trainer</H>
          <ul className="panel divide-y divide-line">
            {o.lateForms.slice(0, 10).map((x) => <li key={x.name} className="flex items-center justify-between gap-3 px-4 py-2.5"><b>{x.name}</b><span className="text-small tabular-nums text-ink-soft">{x.n} late</span></li>)}
            {!o.lateForms.length && <Empty>No forms are late right now.</Empty>}
          </ul>
          <H>Bookings in this range</H>
          <div className="panel p-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-[24px] font-extrabold leading-none tabular-nums">{o.newBookings.reduce((n, x) => n + x.n, 0)}</p><p className="mt-1 text-caption text-ink-soft">new bookings</p></div>
              <div><p className="text-[24px] font-extrabold leading-none tabular-nums">{o.dateChanges}</p><p className="mt-1 text-caption text-ink-soft">date changes</p></div>
              <div><p className={`text-[24px] font-extrabold leading-none tabular-nums ${o.overbooked ? "text-heart" : ""}`}>{o.overbooked}</p><p className="mt-1 text-caption text-ink-soft">overbooked</p></div>
            </div>
            {o.newBookings.length > 0 && <p className="mt-3 text-small text-ink-soft">New: {o.newBookings.map((x) => `${x.name} ${x.n}`).join(" · ")}</p>}
          </div>
          <H n={o.cancellations.length}>Cancelled, and why</H>
          <ul className="panel divide-y divide-line">
            {o.cancellations.slice(0, 8).map((x, i) => <li key={i} className="px-4 py-2.5"><p className="text-body"><b>{x.dog}</b> <span className="text-ink-soft">· {x.client} · {x.trainer} · {x.when.slice(5).replace("-", "/")}</span></p><p className="text-small text-ink-soft">{x.reason}</p></li>)}
            {!o.cancellations.length && <Empty>No cancellations in this range.</Empty>}
          </ul>
          <H n={o.incidents.length}>Incidents reported by trainers</H>
          <ul className="panel divide-y divide-line">
            {o.incidents.slice(0, 8).map((x, i) => <li key={i} className="px-4 py-2.5"><p className="text-body"><b>{x.title}</b> <span className="text-ink-soft">· {x.when.slice(5).replace("-", "/")}</span></p>{x.detail && <p className="text-small text-ink-soft">{x.detail}</p>}</li>)}
            {!o.incidents.length && <Empty>No incident reports in this range.</Empty>}
          </ul>
        </section>
      </div>
    </>
  );
}

// ── Trainers ──
function Trainers({ rows }: { rows: TrainerRow[] }) {
  if (!rows.length) return <p className="text-body text-ink-soft">No trainers with dogs in this range.</p>;
  return (
    <ul className="panel divide-y divide-line">
      {rows.map((t) => (
        <li key={t.id} className="p-4">
          <div className="flex items-center gap-3">
            <span className={`w-6 shrink-0 text-center text-small font-bold tabular-nums ${t.rank ? "text-ink" : "text-ink-faint"}`}>{t.rank ?? "–"}</span>
            <Link prefetch={false} href={`/a/trainers/${t.id}`} className="min-w-0 flex-1 truncate font-bold hover:underline">{t.name}</Link>
            <span className="shrink-0 text-small text-ink-soft">{t.dogs} dog{t.dogs === 1 ? "" : "s"}{t.pay ? ` · ${money(t.pay)}` : ""}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2 md:grid-cols-6">
            <div><p className="text-caption text-ink-faint">Daily updates</p><p className="text-body font-semibold tabular-nums">{t.updateRate == null ? "–" : `${t.updateRate}%`} <span className="text-caption font-normal text-ink-faint">{t.careDays}d</span></p><Bar v={t.updateRate} tone={(t.updateRate ?? 100) < 60 ? "bg-heart" : "bg-lav"} /></div>
            <div><p className="text-caption text-ink-faint">Reply</p><p className="text-body font-semibold tabular-nums">{t.replyN ? minutesLabel(t.replyMedian) : "–"} <span className="text-caption font-normal text-ink-faint">{t.replyN || ""}</span></p></div>
            <div><p className="text-caption text-ink-faint">Forms on time</p><p className="text-body font-semibold tabular-nums">{t.formsOnTime == null ? "–" : `${t.formsOnTime}%`} <span className="text-caption font-normal text-ink-faint">{t.formsN || ""}</span></p></div>
            <div><p className="text-caption text-ink-faint">Alerts</p><p className={`text-body font-semibold tabular-nums ${t.alerts >= 5 ? "text-heart" : ""}`}>{t.alerts}</p></div>
            <div><p className="text-caption text-ink-faint">Kennels used</p><p className="text-body font-semibold tabular-nums">{t.utilisation == null ? "–" : `${t.utilisation}%`} <span className="text-caption font-normal text-ink-faint">{t.capacity ? `of ${t.capacity}` : ""}</span></p>{t.utilisation != null && <Bar v={t.utilisation} tone="bg-fern" />}</div>
            <div><p className="text-caption text-ink-faint">Days off</p><p className={`text-body font-semibold tabular-nums ${t.daysOff >= 7 ? "text-warn" : ""}`}>{t.daysOff}</p></div>
          </div>
          {!t.rank && <p className="mt-1 text-caption text-ink-faint">Not ranked: under a week of data.</p>}
        </li>
      ))}
    </ul>
  );
}

// ── Sales ──
/** Number = leads from that state. Darker = more of them closed. Red edge = a deal was lost there for lack of a nearby trainer. Tap a state to see its figures. */
function TileMap({ s, q }: { s: SalesView; q: Q }) {
  const by = new Map(s.states.map((x) => [x.st, x]));
  const sel = q.state;
  return (
    <div className="panel p-3 md:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-caption text-ink-soft">
        <span>Number = leads. Darker = more of them closed. <span className="mx-1 inline-block h-3 w-3 rounded-[3px] ring-2 ring-heart align-[-2px]" /> = lost: no trainer nearby.</span>
        {sel && <Link prefetch={false} href={href(q, { state: undefined })} className="font-semibold underline">All states</Link>}
      </div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${US_COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${US_ROWS}, minmax(0, 1fr))` }}>
        {US_TILES.map((t) => {
          const c = by.get(t.st), created = c?.created || 0, won = c?.won || 0, conv = created ? won / created : 0;
          const any = !!(c && (c.created || c.won || c.coverageLost)), on = sel === t.st;
          const alpha = won ? 0.35 + 0.65 * Math.min(1, conv / 0.25) : created ? 0.12 : 0; // 25% conversion or better = full colour
          const style = alpha ? { backgroundColor: `rgb(var(--lav-bg) / ${alpha.toFixed(2)})` } : undefined;
          return (
            <Link key={t.st} prefetch={false} href={href(q, { state: on ? undefined : t.st })} aria-label={`${t.name}: ${created} leads, ${won} won${c?.coverageLost ? `, ${c.coverageLost} lost for no trainer` : ""}`}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-[6px] text-[10px] leading-none md:text-small ${won ? "text-white" : any ? "text-ink" : "bg-paper/60 text-ink-faint"} ${c?.coverageLost ? "ring-2 ring-inset ring-heart" : ""} ${on ? "outline outline-2 outline-ink" : ""}`}
              style={{ gridColumn: t.col + 1, gridRow: t.row + 1, ...style }}>
              <span className="font-bold">{t.st}</span>
              {created > 0 && <span className="tabular-nums">{created}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Sales({ s, q }: { s: SalesView; q: Q }) {
  const sel = q.state, cell = sel ? s.states.find((x) => x.st === sel) : null;
  const tiles: Tile[] = [
    { key: "leads", label: "Leads", value: s.leads.toLocaleString("en-US"), sub: s.leadsLastYear != null ? `${s.leadsLastYear.toLocaleString("en-US")} in the same range last year` : "deals created in HubSpot", delta: s.leadsLastYear != null ? delta(s.leads, s.leadsLastYear, true) : { text: "", up: null }, good: "up", how: "Deals created in HubSpot in the range. Every contact becomes a deal, so this is leads. Compared with the same dates one year earlier.", spark: [] },
    { key: "sold", label: "Sold", value: money(s.wonAmount), sub: `${s.won} closed won${s.wonLastYear ? ` · last year ${s.wonLastYear.n} (${money(s.wonLastYear.amount)})` : ""}`, delta: s.wonLastYear ? delta(s.wonAmount, s.wonLastYear.amount, true) : { text: "", up: null }, good: "up", how: "Closed Won by close date, program price. Compared with the same dates last year.", spark: [], to: "/a/sales" },
    { key: "conv", label: "Conversion", value: s.conversion == null ? "–" : `${s.conversion}%`, sub: `${s.won} won of ${s.leads.toLocaleString("en-US")} leads${s.closeN ? ` · ${s.closeDays} days to close (median)` : ""}`, delta: { text: "", up: null }, how: "Won in the range divided by leads created in the range (same window, not the same cohort). Days to close: created to closed, median, for deals won in the range.", spark: [] },
    { key: "cost", label: "Cost per sale", value: s.perSale, sub: `per lead ${s.perLead} · from ${s.perLeadN.toLocaleString("en-US")} leads with credits`, delta: { text: "", up: null }, how: `Only deals that carry Bark credits count; nothing is estimated. Per lead: credits on those leads ÷ their number. Per sale: the same credits ÷ the ${s.perSaleN} won deals that carry credits. ${s.creditUsd ? `1 credit = $${s.creditUsd}.` : "Set BARK_CREDIT_USD in Vercel to see dollars."}`, spark: [] }
  ];
  return (
    <>
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">{tiles.map((t) => <TileCard key={t.key} t={t} />)}</section>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section>
          <H>Where leads come from, and where they close{cell ? `: ${US_TILES.find((x) => x.st === sel)?.name}` : ""}</H>
          <TileMap s={s} q={q} />
          {cell && <p className="mt-2 text-body"><b>{cell.created}</b> leads · <b>{cell.won}</b> won ({money(cell.wonAmount)}) · {cell.created ? Math.round((cell.won / cell.created) * 100) : 0}% closed · {Math.round(cell.credits)} credits{cell.coverageLost ? <> · <span className="font-semibold text-heart">{cell.coverageLost} lost for no trainer nearby</span></> : null}</p>}
          {s.nextMonth && <div className="panel mt-4 p-4"><p className="text-small font-semibold text-ink-soft">What last year says about {s.nextMonth.label}</p><p className="mt-1 text-[26px] font-extrabold leading-none tabular-nums">{s.nextMonth.n} sales · {money(s.nextMonth.amount)}</p><p className="mt-1 text-small text-ink-soft">Closed Won in {s.nextMonth.label} last year. Not a forecast, just what happened.</p></div>}
        </section>
        <section>
          <H>By source</H>
          <ul className="panel divide-y divide-line">
            {s.bySource.map((x) => (
              <li key={x.source} className="p-3">
                <div className="flex justify-between gap-2 text-small"><span className="min-w-0 truncate font-semibold">{x.source}</span><span className="shrink-0 tabular-nums text-ink-soft">{x.created} → {x.won} won · {x.created ? Math.round((x.won / x.created) * 100) : 0}%{x.credits ? ` · ${Math.round(x.credits)} cr` : ""}</span></div>
                <Bar v={x.created ? (x.won / x.created) * 100 : 0} tone="bg-fern" />
              </li>
            ))}
            {!s.bySource.length && <Empty>No source on these deals.</Empty>}
          </ul>
          <H>Salespeople</H>
          <ul className="panel divide-y divide-line">
            {s.people.map((p) => (
              <li key={p.name} className="p-3">
                <div className="flex items-center justify-between gap-2"><b className="min-w-0 truncate">{p.name}</b><span className="shrink-0 text-body font-semibold tabular-nums">{money(p.amount)}</span></div>
                <p className="mt-0.5 text-small tabular-nums text-ink-soft">{p.leads} leads → {p.won} won · {p.calls} calls, {p.emails} emails{p.won ? ` · ${Math.round(p.calls / p.won)} calls per sale` : ""}</p>
              </li>
            ))}
            {!s.people.length && <Empty>No salespeople with activity in this range.</Empty>}
          </ul>
          <p className="mt-1 text-caption text-ink-faint">Leads = deals created and owned by them. Calls and emails = logged in HubSpot in the range.</p>
        </section>
      </div>
    </>
  );
}

export function PulseView({ p, q }: { p: Pulse; q: Q }) {
  const active = q.from ? "custom" : (q.r || "14d");
  const tile = (k: string) => p.tiles.find((t) => t.key === k)!;
  const keys = p.view === "office" ? ["update", "team", "waiting", "care"] : p.view === "trainers" ? ["update", "reply", "forms", "waiting"] : [];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 font-extrabold leading-tight">Pulse <Pill tone="line">Preview</Pill></h1>
          <p className="text-body text-ink-soft">{p.range.label} · compared with the {p.range.days} days before</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-caption text-ink-faint">
            <span>Pulled {p.stats.points.toLocaleString("en-US")} data points in {(p.stats.ms / 1000).toFixed(1)} s, as of {new Date(p.stats.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET</span>
            <PulseRefresh />
          </p>
        </div>
        <form className="flex flex-wrap items-center gap-2" method="get">
          <input type="hidden" name="v" value={p.view} />
          {PRESETS.map((x) => <Link key={x.key} prefetch={false} href={href(q, { r: x.key, from: undefined, to: undefined })} className={`rounded-full px-3 py-1.5 text-small font-semibold ${active === x.key ? "bg-ink text-white" : "border border-line bg-white text-ink-soft"}`}>{x.label}</Link>)}
          <span className="flex items-center gap-1">
            <input type="date" name="from" defaultValue={q.from || ""} className="field h-9 w-[9.5rem] px-2 text-small" aria-label="From" />
            <input type="date" name="to" defaultValue={q.to || ""} className="field h-9 w-[9.5rem] px-2 text-small" aria-label="To" />
            <button type="submit" className="btn-ghost h-9 min-h-0 px-3 text-small">Go</button>
          </span>
        </form>
      </div>

      <nav className="mb-4 grid grid-cols-3 rounded-2xl border border-line bg-white p-1 text-body font-semibold shadow-card sm:inline-grid sm:w-auto" aria-label="View">
        {VIEWS.map((v) => <Link key={v.key} prefetch={false} href={href(q, { v: v.key, state: undefined })} aria-current={p.view === v.key ? "page" : undefined} className={`flex items-center justify-center rounded-xl px-5 py-2.5 ${p.view === v.key ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>{v.label}</Link>)}
      </nav>

      {p.cards.length > 0 && (
        <section aria-label="Needs a decision" className="-mx-4 mb-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3">
          {p.cards.map((c, i) => <CardView key={i} c={c} />)}
        </section>
      )}

      {keys.length > 0 && <section aria-label="The numbers" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">{keys.map((k) => <TileCard key={k} t={tile(k)} />)}</section>}

      {p.view === "office" && p.office && <Office o={p.office} />}
      {p.view === "trainers" && (
        <section>
          <H>Trainers</H>
          <p className="mb-3 text-small text-ink-soft">Ranked by daily updates (lower confidence bound, so thin data doesn&apos;t win), then reply time. Pay = payslips for runs ending in the range. Kennels used = dog-days ÷ capacity × days. Quiet chats and days before the cutover don&apos;t count against anyone.</p>
          <Trainers rows={p.trainers} />
        </section>
      )}
      {p.view === "sales" && (p.sales ? <Sales s={p.sales} q={q} /> : <p className="text-body text-ink-soft">Sales needs HubSpot.</p>)}

      {p.notes.length > 0 && <p className="mt-4 text-caption text-ink-faint">{p.notes.join(" ")}</p>}
    </>
  );
}

function delta(now: number, before: number, pctMode: boolean): { text: string; up: boolean | null } {
  if (before === 0) return { text: now ? "new" : "same", up: now ? true : null };
  const d = now - before; if (!d) return { text: "same", up: null };
  return { text: pctMode ? `${d > 0 ? "+" : "−"}${Math.abs(Math.round((d / before) * 100))}%` : `${d > 0 ? "+" : "−"}${Math.abs(d)}`, up: d > 0 };
}
