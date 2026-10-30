import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Info } from "lucide-react";
import { Pill } from "@/components/ui";
import { PulseRefresh } from "@/components/PulseRefresh";
import { MovesStrip } from "@/components/MovesStrip";
import type { Card, OfficeView, Pulse, SalesView, Tile, TrainerRow, View } from "@/lib/pulse";
import { PRESETS } from "@/lib/pulse";
import { minutesLabel } from "@/lib/pulseMath";
import { US_COLS, US_ROWS, US_TILES } from "@/lib/usTiles";

// Pulse: Office (clients and the link to trainers), Trainers (how each is doing), Sales (leads, conversion, cost, history).
// Mobile first: cards scroll sideways, tiles two across, the map is a grid of state squares, the chart is plain SVG bars.

type Q = { r?: string; from?: string; to?: string; v?: string; state?: string };
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const VIEWS: { key: View; label: string }[] = [{ key: "office", label: "Office" }, { key: "trainers", label: "Trainers" }, { key: "sales", label: "Sales" }];
const href = (q: Q, patch: Partial<Q>) => { const p = new URLSearchParams(); const all = { ...q, ...patch }; for (const k of ["v", "r", "from", "to", "state"] as const) if (all[k]) p.set(k, all[k]!); const s = p.toString(); return s ? `/a/pulse?${s}` : "/a/pulse"; };
function dlt(now: number, before: number, pctMode: boolean): { text: string; up: boolean | null } {
  if (before === 0) return { text: now ? "new" : "same", up: now ? true : null };
  const d = now - before; if (!d) return { text: "same", up: null };
  return { text: pctMode ? `${d > 0 ? "+" : "−"}${Math.abs(Math.round((d / before) * 100))}%` : `${d > 0 ? "+" : "−"}${Math.abs(d)}`, up: d > 0 };
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-7" />;
  const max = Math.max(1, ...values), w = 100, h = 28;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 4)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-7 w-full text-lav" aria-hidden><polygon points={`0,${h} ${line} ${w},${h}`} fill="currentColor" opacity="0.15" /><polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>;
}
function Delta({ t }: { t: Tile }) {
  if (!t.delta.text || t.delta.up === null) return t.delta.text ? <span className="text-small text-ink-faint">{t.delta.text}</span> : null;
  const good = t.good ? (t.good === "up") === t.delta.up : null, cls = good === null ? "text-ink-soft" : good ? "text-fern" : "text-heart";
  return <span className={`inline-flex items-center gap-0.5 text-small font-semibold ${cls}`}>{t.delta.up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{t.delta.text}</span>;
}
function TileCard({ t }: { t: Tile }) {
  const num = <p className="mt-1 text-[30px] font-extrabold leading-none tabular-nums tracking-tight md:text-[36px]">{t.value}</p>;
  return (
    <div className="panel flex flex-col p-4">
      <div className="flex items-start justify-between gap-2"><p className="text-small font-semibold text-ink-soft">{t.label}</p><Delta t={t} /></div>
      {t.to ? <Link prefetch={false} href={t.to} className="group inline-flex items-baseline gap-1 hover:underline">{num}<ChevronRight size={16} className="text-ink-faint group-hover:text-ink" /></Link> : num}
      <p className="mt-1.5 text-small text-ink-soft">{t.sub}</p>
      <div className="mt-2">{t.spark.length ? <Spark values={t.spark} /> : <div className="h-7" />}</div>
      <details className="group mt-1"><summary className="flex cursor-pointer list-none items-center gap-1 text-caption text-ink-faint [&::-webkit-details-marker]:hidden"><Info size={12} />How it&apos;s worked out{t.n ? ` · ${t.n}` : ""}</summary><p className="mt-1 text-caption text-ink-soft">{t.how}</p></details>
    </div>
  );
}
function CardView({ c }: { c: Card }) {
  const tone = c.tone === "heart" ? "border-heart/30 bg-heart-wash" : c.tone === "biscuit" ? "border-biscuit/40 bg-biscuit-wash" : "border-mint-deep/30 bg-mint-wash", text = c.tone === "heart" ? "text-heart" : c.tone === "biscuit" ? "text-warn" : "text-fern";
  const inner = <><p className={`text-body font-bold leading-snug ${text}`}>{c.title}</p><p className="mt-1 text-small text-ink-soft">{c.evidence}</p>{c.action && <p className={`mt-2 inline-flex items-center gap-1 text-small font-semibold ${text}`}>{c.action}<ChevronRight size={14} /></p>}
    {c.more && c.more.items.length > 0 && <details className="mt-2"><summary className="cursor-pointer list-none text-small font-semibold text-ink-soft [&::-webkit-details-marker]:hidden">{c.more.label} ▾</summary><ul className="mt-1 text-small text-ink-soft">{c.more.items.map((x) => <li key={x}>{x}</li>)}</ul></details>}</>;
  const cls = `block w-[82vw] shrink-0 snap-start rounded-2xl border p-4 md:w-auto ${tone}`;
  return c.href ? <Link prefetch={false} href={c.href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
}
const Bar = ({ v, tone = "bg-lav" }: { v: number | null; tone?: string }) => <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }} /></div>;
const H = ({ children, n }: { children: React.ReactNode; n?: number }) => <h2 className="mb-2 mt-5 text-lead font-extrabold first:mt-0">{children}{n !== undefined && <span className="ml-2 text-body font-semibold text-ink-soft">{n}</span>}</h2>;
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
            {o.silent24.slice(0, 10).map((x) => <li key={x.href}><Link prefetch={false} href={x.href} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-paper/60"><span className="min-w-0 truncate"><b>{x.dog}</b> <span className="text-ink-soft">· {x.client} · {x.trainer}</span></span><span className={`shrink-0 text-small font-semibold tabular-nums ${x.hours >= 48 ? "text-heart" : "text-warn"}`}>{x.hours >= 48 ? `${Math.round(x.hours / 24)} d` : `${x.hours} h`}</span></Link></li>)}
            {!o.silent24.length && <Empty>Every client has heard from Dogwise in the last 24 hours.</Empty>}
          </ul>
          <H n={o.waitingClients.length}>Clients below the promised frequency</H>
          <ul className="panel divide-y divide-line">
            {o.waitingClients.slice(0, 10).map((x) => <li key={x.href}><Link prefetch={false} href={x.href} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-paper/60"><span className="min-w-0 truncate"><b>{x.client}</b> <span className="text-ink-soft">· {x.dog}</span></span><span className="shrink-0 text-small font-semibold tabular-nums text-heart">{x.n}× waiting</span></Link></li>)}
            {!o.waitingClients.length && <Empty>No client was left waiting twice in this range.</Empty>}
          </ul>
          <H n={o.balances.length}>Balance still owed, start coming up</H>
          <ul className="panel divide-y divide-line">
            {o.balances.slice(0, 8).map((x, i) => <li key={i}>{x.href ? <Link prefetch={false} href={x.href} className="block px-4 py-2.5 text-body hover:bg-paper/60">{x.text}</Link> : <span className="block px-4 py-2.5 text-body">{x.text}</span>}</li>)}
            {!o.balances.length && <Empty>Nobody starting soon still owes a balance.</Empty>}
          </ul>
          <div className="mt-5"><MovesStrip moves={o.moves} limit={40} title="Pickups and drop-offs, next 14 days" /></div>
        </section>
        <section>
          <H n={o.slowTrainers.length}>Trainers with repeated comms alerts</H>
          <ul className="panel divide-y divide-line">
            {o.slowTrainers.map((x) => <li key={x.href}><Link prefetch={false} href={x.href} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-paper/60"><b>{x.name}</b><span className="text-small font-semibold tabular-nums text-heart">{x.alerts} alerts</span></Link></li>)}
            {!o.slowTrainers.length && <Empty>No trainer had {o.alertBar}+ alerts in this range.</Empty>}
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
            {o.newBookings.length > 0 && <p className="mt-3 text-small text-ink-soft">New: {o.newBookings.slice(0, 12).map((x) => `${x.name} ${x.n}`).join(" · ")}{o.newBookings.length > 12 ? ` · +${o.newBookings.length - 12} more` : ""}</p>}
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
function Score({ t }: { t: TrainerRow }) {
  if (t.score == null) return <div className="w-20 shrink-0 text-right"><p className="text-[22px] font-extrabold leading-none text-ink-faint">–</p><p className="mt-1 text-caption text-ink-faint">no data</p></div>;
  const tone = t.score >= 75 ? "text-fern" : t.score >= 50 ? "text-ink" : "text-heart";
  return (
    <div className="w-24 shrink-0 text-right">
      <p className={`text-[26px] font-extrabold leading-none tabular-nums ${tone}`}>{t.score}<span className="text-small font-semibold text-ink-faint">%</span></p>
      {t.confidence === "low" && <p className="mt-1 text-caption font-semibold text-warn">Low data: may be unreliable</p>}
      {t.unusual && <p className="mt-1 text-caption font-semibold text-warn">Unusual for this trainer (usually {t.baseline}%)</p>}
      {t.confidence === "ok" && !t.unusual && t.baseline != null && <p className="mt-1 text-caption text-ink-faint">90-day: {t.baseline}%</p>}
    </div>
  );
}
function Trainers({ rows }: { rows: TrainerRow[] }) {
  return (
    <ul className="panel divide-y divide-line">
      {rows.map((t) => (
        <li key={t.id} className="p-4">
          <div className="flex items-start gap-3">
            <span className={`w-6 shrink-0 pt-1 text-center text-small font-bold tabular-nums ${t.rank ? "text-ink" : "text-ink-faint"}`}>{t.rank ?? "–"}</span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-2"><Link prefetch={false} href={`/a/trainers/${t.id}`} className="min-w-0 truncate font-bold hover:underline">{t.name}</Link><span className="shrink-0 text-small text-ink-soft">{t.dogs} dog{t.dogs === 1 ? "" : "s"}{t.appDogs && t.appDogs < t.dogs ? ` · ${t.appDogs} in app chats` : ""}</span></p>
              <p className="mt-0.5 text-small text-ink-soft">{t.summary}</p>
            </div>
            <Score t={t} />
          </div>
          {(t.careDays > 0 || t.formsN > 0 || t.replyN > 0) && (
            <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 md:grid-cols-6">
              <div><p className="text-caption text-ink-faint">Daily updates</p><p className="text-body font-semibold tabular-nums">{t.updateRate == null ? "–" : `${t.updateRate}%`} <span className="text-caption font-normal text-ink-faint">{t.careDays}d</span></p><Bar v={t.updateRate} tone={(t.updateRate ?? 100) < 60 ? "bg-heart" : "bg-lav"} /></div>
              <div><p className="text-caption text-ink-faint">Reply</p><p className="text-body font-semibold tabular-nums">{t.replyN ? minutesLabel(t.replyMedian) : "–"} <span className="text-caption font-normal text-ink-faint">{t.replyN || ""}</span></p></div>
              <div><p className="text-caption text-ink-faint">Forms on time</p><p className="text-body font-semibold tabular-nums">{t.formsOnTime == null ? "–" : `${t.formsOnTime}%`} <span className="text-caption font-normal text-ink-faint">{t.formsN || ""}</span></p></div>
              <div><p className="text-caption text-ink-faint">Alerts</p><p className={`text-body font-semibold tabular-nums ${t.alerts >= 5 ? "text-heart" : ""}`}>{t.alerts}</p></div>
              <div><p className="text-caption text-ink-faint">Kennels used</p><p className="text-body font-semibold tabular-nums">{t.utilisation == null ? "–" : `${t.utilisation}%`} <span className="text-caption font-normal text-ink-faint">{t.cap ? `of ${t.cap}` : ""}</span></p>{t.utilisation != null && <Bar v={t.utilisation} tone="bg-fern" />}</div>
              <div><p className="text-caption text-ink-faint">Days off</p><p className={`text-body font-semibold tabular-nums ${t.daysOff >= 7 ? "text-warn" : ""}`}>{t.daysOff}{t.offNote && <span className="block text-caption font-normal text-ink-faint">{t.offNote}</span>}</p></div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Sales ──
/** Each square: the state in the corner, its leads in the middle, a purple fill from the bottom for sales (height = share of the busiest state), and the sales count in a dark badge. Red edge = that state's kennels are 80%+ full today. */
function TileMap({ s, q }: { s: SalesView; q: Q }) {
  const by = new Map(s.states.map((x) => [x.st, x])), maxWon = Math.max(1, ...s.states.map((x) => x.won)), sel = q.state;
  return (
    <div className="panel p-3 md:p-4">
      <div className="mb-3 grid gap-x-4 gap-y-1 text-caption text-ink-soft sm:grid-cols-2">
        <span><b className="text-ink">Big number</b> = leads from that state</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded-[3px] bg-lav/60 align-[-2px]" /><b className="text-ink">Purple fill</b> = sales, as a share of the busiest state</span>
        <span><span className="mr-1 inline-block rounded bg-canvas px-1 text-[9px] font-bold text-ink ring-1 ring-line">12</span><b className="text-ink">Badge</b> = number of sales</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded-[3px] ring-2 ring-heart align-[-2px]" /><b className="text-ink">Red edge</b> = kennels there 80%+ full today</span>
      </div>
      {sel && <p className="mb-2 text-caption"><Link prefetch={false} href={href(q, { state: undefined })} className="font-semibold underline">Show all states</Link></p>}
      <div className="grid gap-[3px] md:gap-1" style={{ gridTemplateColumns: `repeat(${US_COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${US_ROWS}, minmax(0, 1fr))` }}>
        {US_TILES.map((t) => {
          const c = by.get(t.st), leads = c?.leads || 0, won = c?.won || 0, any = !!(c && (leads || won)), on = sel === t.st;
          const fill = won ? Math.max(14, Math.round((won / maxWon) * 100)) : 0;
          return (
            <Link key={t.st} prefetch={false} href={href(q, { state: on ? undefined : t.st })} aria-label={`${t.name}: ${leads} leads, ${won} sales${c?.full ? ", kennels 80%+ full" : ""}`}
              className={`relative isolate flex aspect-square flex-col items-center justify-center overflow-hidden rounded-[6px] ${any ? "bg-paper text-ink" : "bg-paper/50 text-ink-faint"} ${c?.full ? "ring-2 ring-inset ring-heart" : ""} ${on ? "outline outline-2 outline-ink" : ""}`}
              style={{ gridColumn: t.col + 1, gridRow: t.row + 1 }}>
              {fill > 0 && <span className="absolute inset-x-0 bottom-0 -z-10 bg-lav/60" style={{ height: `${fill}%` }} aria-hidden />}
              <span className={`absolute left-1 top-0.5 text-[8px] font-bold leading-none md:text-[10px] ${any ? "text-ink-soft" : "text-ink-faint"}`}>{t.st}</span>
              {leads > 0 && <span className="text-[11px] font-extrabold leading-none tabular-nums md:text-[15px]">{leads}</span>}
              {won > 0 && <span className="absolute bottom-0.5 right-0.5 rounded bg-canvas px-1 text-[8px] font-bold leading-[1.4] tabular-nums text-ink ring-1 ring-line md:text-[10px]">{won}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
/** Sales per day or week, this range in front, the same dates last year behind. */
function SalesChart({ s }: { s: SalesView }) {
  const max = Math.max(1, ...s.chart.map((b) => Math.max(b.now, b.ly))), w = 100, h = 40, n = s.chart.length, bw = w / Math.max(1, n);
  return (
    <div className="panel p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-caption text-ink-soft">
        <span>Sales per {s.chartUnit}{s.chartState ? ` in ${s.chartState}` : ""} · <span className="inline-block h-2.5 w-2.5 rounded-sm bg-lav align-[-1px]" /> this range · <span className="inline-block h-2.5 w-2.5 rounded-sm bg-line align-[-1px]" /> same dates last year</span>
        <span className="tabular-nums">{s.chart.reduce((k, b) => k + b.now, 0)} vs {s.chart.reduce((k, b) => k + b.ly, 0)} last year</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-28 w-full" aria-hidden>
        {s.chart.map((b, i) => <g key={i}><rect x={i * bw + bw * 0.1} y={h - (b.ly / max) * (h - 2)} width={bw * 0.8} height={(b.ly / max) * (h - 2)} className="fill-line" /><rect x={i * bw + bw * 0.28} y={h - (b.now / max) * (h - 2)} width={bw * 0.44} height={(b.now / max) * (h - 2)} className="fill-lav" rx="0.6" /></g>)}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-faint md:text-caption"><span>{s.chart[0]?.label}</span>{n > 2 && <span>{s.chart[Math.floor(n / 2)]?.label}</span>}<span>{s.chart[n - 1]?.label}</span></div>
    </div>
  );
}
function Sales({ s, q }: { s: SalesView; q: Q }) {
  const sel = q.state, cell = sel ? s.states.find((x) => x.st === sel) : null;
  const tiles: Tile[] = [
    { key: "leads", label: "Leads", value: s.leads.toLocaleString("en-US"), sub: s.leadsLY ? `${s.leadsLY.toLocaleString("en-US")} on the same dates last year` : "deals created in HubSpot", delta: s.leadsLY ? dlt(s.leads, s.leadsLY, true) : { text: "", up: null }, good: "up", how: `Deals created in HubSpot in the range (every contact becomes a deal, so this is leads), against the same dates one year earlier. The map and the salespeople's lead counts use the newest ${s.sample.toLocaleString("en-US")} leads' shares, scaled to this total; sources are counted exactly.`, spark: [] },
    { key: "sold", label: "Sold", value: money(s.wonAmount), sub: `${s.won} closed won · last year ${s.wonLY.n} (${money(s.wonLY.amount)})`, delta: s.wonLY.amount ? dlt(s.wonAmount, s.wonLY.amount, true) : { text: "", up: null }, good: "up", how: "Closed Won by close date, program price, against the same dates last year.", spark: [], to: "/a/sales" },
    { key: "conv", label: "Conversion", value: s.conversion == null ? "–" : `${s.conversion}%`, sub: `${s.conversionLY != null ? `${s.conversionLY}% last year · ` : ""}${s.closeN ? `${s.closeDays} days to close (median)` : ""}`, delta: s.conversionLY ? dlt(s.conversion || 0, s.conversionLY, true) : { text: "", up: null }, good: "up", how: "Won in the range ÷ leads created in the range (same window, not the same cohort), and the same for last year. Days to close: created to closed, median, for deals won in the range.", spark: [] },
    { key: "cost", label: "Cost per sale", value: s.perSale, sub: `per lead ${s.perLead} · average of ${s.perLeadN.toLocaleString("en-US")} leads with credits`, delta: { text: "", up: null }, how: `Average credits per lead, measured only on leads that carry Bark credits (${s.perLeadN.toLocaleString("en-US")} of the newest ${s.sample.toLocaleString("en-US")}), applied to all ${s.leads.toLocaleString("en-US")} leads, divided by all ${s.perSaleN} sales. ${s.creditUsd ? `1 credit = $${s.creditUsd}.` : "Set BARK_CREDIT_USD in Vercel to see dollars."}`, spark: [] }
  ];
  return (
    <>
      <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">{tiles.map((t) => <TileCard key={t.key} t={t} />)}</section>
      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="panel p-4">
          <p className="text-small font-semibold text-ink-soft">What to beat: {s.month.label}</p>
          <p className="mt-1 text-[26px] font-extrabold leading-none tabular-nums">{s.month.n} <span className="text-body font-semibold text-ink-soft">so far · {money(s.month.amount)}</span></p>
          <p className="mt-2 text-small text-ink-soft">By this day last year: <b>{s.month.lyToDate}</b> ({money(s.month.lyToDateAmount)}). The whole of {s.month.label} last year: <b>{s.month.lyFull}</b> ({money(s.month.lyFullAmount)}).</p>
        </div>
        <div className="panel p-4">
          <p className="text-small font-semibold text-ink-soft">What last year says about {s.nextMonth.label}</p>
          <p className="mt-1 text-[26px] font-extrabold leading-none tabular-nums">{s.nextMonth.n} <span className="text-body font-semibold text-ink-soft">sales · {money(s.nextMonth.amount)}</span></p>
          <p className="mt-2 text-small text-ink-soft">Closed Won in {s.nextMonth.label} last year. Not a forecast, just what happened.</p>
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section>
          <H>Where leads come from, and where they close{cell ? `: ${US_TILES.find((x) => x.st === sel)?.name}` : ""}</H>
          <TileMap s={s} q={q} />
          {cell && <p className="mt-2 text-body"><b>{cell.leads}</b> leads · <b>{cell.won}</b> sales ({money(cell.wonAmount)}) · {cell.leads ? Math.round((cell.won / cell.leads) * 100) : 0}% closed{cell.full ? <> · <span className="font-semibold text-heart">kennels 80%+ full</span></> : null}</p>}
          <div className="mt-4"><SalesChart s={s} /></div>
          {!sel && <p className="mt-1 text-caption text-ink-faint">Tap a state on the map to see its chart.</p>}
        </section>
        <section>
          <H>By source</H>
          <ul className="panel divide-y divide-line">
            {s.bySource.map((x) => (
              <li key={x.source} className="p-3">
                <div className="flex justify-between gap-2 text-small"><span className="min-w-0 truncate font-semibold">{x.source}</span><span className="shrink-0 tabular-nums text-ink-soft">{x.leads} → {x.won} won · {x.conversion}%{x.perSale ? ` · ${x.perSale} per sale` : ""}</span></div>
                <Bar v={x.conversion * 4} tone="bg-fern" />
              </li>
            ))}
            {!s.bySource.length && <Empty>No source on these deals.</Empty>}
          </ul>
          <p className="mt-1 text-caption text-ink-faint">Leads per source counted in HubSpot for {s.peopleRange.toLowerCase()}. Bar = conversion (full at 25%). Per sale = that source&apos;s average credits per lead × its leads, ÷ its sales.</p>
          <H>Salespeople</H>
          <ul className="panel divide-y divide-line">
            {s.people.map((p) => (
              <li key={p.name} className="p-3">
                <div className="flex items-center justify-between gap-2"><b className="min-w-0 truncate">{p.name}</b><span className="shrink-0 text-body font-semibold tabular-nums">{money(p.amount)}</span></div>
                <p className="mt-0.5 text-small tabular-nums text-ink-soft">{p.leads} leads → {p.won} won{p.conversion != null ? ` (${p.conversion}%)` : ""} · {p.calls ? `${p.calls.toLocaleString("en-US")} calls${p.won ? `, ${Math.round(p.calls / p.won)} per sale` : ""}` : "no calls logged under their name"}{s.emailsLogged ? ` · ${p.emails} emails` : ""}</p>
              </li>
            ))}
            {!s.people.length && <Empty>No salespeople with activity in this range.</Empty>}
          </ul>
          <p className="mt-1 text-caption text-ink-faint">Calls counted for {s.peopleRange.toLowerCase()}, as logged in HubSpot. Won and dollars from the app&apos;s deal copy.{s.emailsLogged ? "" : " Emails aren't logged in HubSpot, so they're not shown."}</p>
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
            <span>Snapshot of {p.stats.points.toLocaleString("en-US")} data points, taken {new Date(p.stats.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET</span>
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
      {p.cards.length > 0 && <section aria-label="Needs a decision" className="-mx-4 mb-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3">{p.cards.map((c, i) => <CardView key={i} c={c} />)}</section>}
      {keys.length > 0 && <section aria-label="The numbers" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">{keys.map((k) => <TileCard key={k} t={tile(k)} />)}</section>}
      {p.view === "office" && p.office && <Office o={p.office} />}
      {p.view === "trainers" && (
        <section>
          <H>Trainers</H>
          <p className="mb-3 text-small text-ink-soft">Score = daily updates 40, replies 25, forms 20, alerts 15 (parts with no data drop out; small samples are pulled toward the group). Ranked by score. Kennels used = dog-days ÷ capacity × days. Quiet chats and days before the cutover don&apos;t count against anyone.</p>
          <Trainers rows={p.trainers} />
        </section>
      )}
      {p.view === "sales" && (p.sales ? <Sales s={p.sales} q={q} /> : <p className="text-body text-ink-soft">Sales couldn&apos;t load from HubSpot this time. Press Refresh to take a new snapshot.</p>)}
      {p.notes.length > 0 && <p className="mt-4 text-caption text-ink-faint">{p.notes.join(" ")}</p>}
    </>
  );
}
