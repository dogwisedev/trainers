import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Info } from "lucide-react";
import { Pill } from "@/components/ui";
import type { Card, Pulse, SalesView, Tile, TrainerRow, View } from "@/lib/pulse";
import { PRESETS } from "@/lib/pulse";
import { minutesLabel } from "@/lib/pulseMath";
import { US_COLS, US_ROWS, US_TILES } from "@/lib/usTiles";
import { PulseRefresh } from "@/components/PulseRefresh";

// Pulse: one screen per audience (Clients, Trainers, Sales, Office), switched like the Chats page. Each view: the range,
// what needs a decision, a few big numbers (each opens the list behind it), then one main picture and one list.
// Mobile first: cards scroll sideways, tiles two across, the map is a grid of state squares that works at phone width.

type Q = { r?: string; from?: string; to?: string; v?: string; state?: string };
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const VIEWS: { key: View; label: string }[] = [{ key: "clients", label: "Clients" }, { key: "trainers", label: "Trainers" }, { key: "sales", label: "Sales" }, { key: "office", label: "Office" }];
const href = (q: Q, patch: Partial<Q>) => { const p = new URLSearchParams(); const all = { ...q, ...patch }; for (const k of ["v", "r", "from", "to", "state"] as const) if (all[k]) p.set(k, all[k]!); const s = p.toString(); return s ? `/a/pulse?${s}` : "/a/pulse"; };

function Spark({ values, tone = "text-lav" }: { values: number[]; tone?: string }) {
  if (values.length < 2) return <div className="h-7" />;
  const max = Math.max(1, ...values), w = 100, h = 28;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 4)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`h-7 w-full ${tone}`} aria-hidden>
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

/** A big number. Tap the number to open the list behind it; "How it's worked out" folds out underneath. */
function TileCard({ t, to }: { t: Tile; to?: string }) {
  const num = <p className="mt-1 text-[32px] font-extrabold leading-none tabular-nums tracking-tight md:text-[36px]">{t.value}</p>;
  return (
    <div className="panel flex flex-col p-4">
      <div className="flex items-start justify-between gap-2"><p className="text-small font-semibold text-ink-soft">{t.label}</p><Delta t={t} /></div>
      {to ? <Link prefetch={false} href={to} className="group inline-flex items-baseline gap-1 hover:underline">{num}<ChevronRight size={16} className="text-ink-faint group-hover:text-ink" /></Link> : num}
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

function Trainers({ rows }: { rows: TrainerRow[] }) {
  if (!rows.length) return <p className="text-body text-ink-soft">No trainers with dogs in this range.</p>;
  return (
    <ul className="panel divide-y divide-line">
      {rows.map((t) => (
        <li key={t.id} className="p-4">
          <div className="flex items-center gap-3">
            <span className={`w-6 shrink-0 text-center text-small font-bold tabular-nums ${t.rank ? "text-ink" : "text-ink-faint"}`}>{t.rank ?? "–"}</span>
            <Link prefetch={false} href={`/a/trainers/${t.id}`} className="min-w-0 flex-1 truncate font-bold hover:underline">{t.name}</Link>
            <span className="shrink-0 text-small text-ink-soft">{t.dogs} dog{t.dogs === 1 ? "" : "s"} · {t.weeks} wk</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-5">
            <div><p className="text-caption text-ink-faint">Daily updates</p><p className="text-body font-semibold tabular-nums">{t.updateRate == null ? "–" : `${t.updateRate}%`} <span className="text-caption font-normal text-ink-faint">{t.careDays}d</span></p><Bar v={t.updateRate} tone={(t.updateRate ?? 100) < 60 ? "bg-heart" : "bg-lav"} /></div>
            <div><p className="text-caption text-ink-faint">Reply (median)</p><p className="text-body font-semibold tabular-nums">{t.replyN ? minutesLabel(t.replyMedian) : "–"} <span className="text-caption font-normal text-ink-faint">{t.replyN ? `${t.replyN}` : "no data"}</span></p></div>
            <div><p className="text-caption text-ink-faint">Forms on time</p><p className="text-body font-semibold tabular-nums">{t.formsOnTime == null ? "–" : `${t.formsOnTime}%`} <span className="text-caption font-normal text-ink-faint">{t.formsN ? `${t.formsN}` : "none"}</span></p></div>
            <div><p className="text-caption text-ink-faint">Alerts</p><p className={`text-body font-semibold tabular-nums ${t.alerts >= 5 ? "text-heart" : ""}`}>{t.alerts}</p></div>
            <div><p className="text-caption text-ink-faint">Pay (runs ending in range)</p><p className="text-body font-semibold tabular-nums">{t.pay ? money(t.pay) : "–"}</p></div>
          </div>
          {!t.rank && <p className="mt-1 text-caption text-ink-faint">Not ranked: under a week of data.</p>}
        </li>
      ))}
    </ul>
  );
}

/** Where deals come from (number), where sales come from (fill), where there was no trainer (ring). Tap a state to filter the lists. */
function TileMap({ s, q }: { s: SalesView; q: Q }) {
  const by = new Map(s.states.map((x) => [x.st, x]));
  const maxWon = Math.max(1, ...s.states.map((x) => x.wonAmount)), maxCreated = Math.max(1, ...s.states.map((x) => x.created));
  const sel = q.state;
  return (
    <div className="panel p-3 md:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-caption text-ink-soft">
        <span><span className="mr-1 inline-block h-3 w-3 rounded-[3px] bg-lav align-[-2px]" /> fill = sales $ · number = deals created · <span className="mx-1 inline-block h-3 w-3 rounded-[3px] ring-2 ring-heart align-[-2px]" /> no trainer nearby</span>
        {sel && <Link prefetch={false} href={href(q, { state: undefined })} className="font-semibold underline">Show all states</Link>}
      </div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${US_COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${US_ROWS}, minmax(0, 1fr))` }}>
        {US_TILES.map((t) => {
          const c = by.get(t.st), won = c?.wonAmount || 0, created = c?.created || 0;
          const alpha = won ? 0.3 + 0.7 * (won / maxWon) : 0, big = created / maxCreated;
          const on = sel === t.st, any = !!(c && (c.created || c.won || c.coverageLost));
          const style = won ? { backgroundColor: `rgb(var(--lav-bg) / ${alpha.toFixed(2)})` } : undefined;
          return (
            <Link key={t.st} prefetch={false} href={href(q, { state: on ? undefined : t.st })} aria-label={`${t.name}: ${created} created, ${c?.won || 0} won${c?.coverageLost ? `, ${c.coverageLost} lost for no trainer` : ""}`}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-[6px] text-[10px] leading-none md:text-small ${won ? "text-white" : any ? "bg-paper text-ink" : "bg-paper/60 text-ink-faint"} ${c?.coverageLost ? "ring-2 ring-inset ring-heart" : ""} ${on ? "outline outline-2 outline-ink" : ""}`}
              style={{ gridColumn: t.col + 1, gridRow: t.row + 1, ...style }}>
              <span className="font-bold">{t.st}</span>
              {created > 0 && <span className={`tabular-nums ${big > 0.5 ? "font-bold" : ""}`}>{created}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Sales({ s, q }: { s: SalesView; q: Q }) {
  const sel = q.state, cell = sel ? s.states.find((x) => x.st === sel) : null;
  const wonList = sel ? s.wonList.filter((w) => w.st === sel) : s.wonList;
  const tiles = [
    { label: "Deals created", value: s.capped ? `${s.created}+` : String(s.created), sub: s.capped ? `of ${s.createdTotal} in the range` : "new deals in the range", how: "Deals created in HubSpot in the range. Every contact becomes a deal, so this is leads, not qualified pipeline." },
    { label: "Sold", value: money(s.wonAmount), sub: `${s.won} closed won`, how: "Closed Won by close date, with the program price.", to: "/a/sales" },
    { label: "Cost per lead", value: s.perLead, sub: s.creditCost != null ? `${money(s.creditCost)} on Bark credits` : `${Math.round(s.credits)} Bark credits spent`, how: "Bark credits on deals created in the range, divided by deals created. Dollars when BARK_CREDIT_USD is set in Vercel." },
    { label: "Cost per sale", value: s.perSale, sub: s.closeN ? `median ${s.closeDays} days to close` : "no close dates", how: "Bark credits spent in the range divided by deals won in the range (same window, not the same cohort). Days to close: created to closed, median, for deals won in the range." }
  ];
  return (
    <>
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => <TileCard key={t.label} to={t.to} t={{ key: t.label, label: t.label, value: t.value, sub: t.sub, delta: { text: "", up: null }, how: t.how, spark: [] }} />)}
      </section>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="mb-2 text-lead font-extrabold">Where deals come from, where sales come from{cell ? `: ${US_TILES.find((x) => x.st === sel)?.name}` : ""}</h2>
          <TileMap s={s} q={q} />
          {cell && <p className="mt-2 text-body"><b>{cell.created}</b> created · <b>{cell.won}</b> won ({money(cell.wonAmount)}) · {Math.round(cell.credits)} credits{cell.coverageLost ? <> · <span className="font-semibold text-heart">{cell.coverageLost} lost for no trainer nearby</span></> : null}</p>}
        </section>
        <section>
          <h2 className="mb-2 text-lead font-extrabold">By source</h2>
          <ul className="panel divide-y divide-line">
            {s.bySource.map((x) => (
              <li key={x.source} className="p-3">
                <div className="flex justify-between gap-2 text-small"><span className="min-w-0 truncate font-semibold">{x.source}</span><span className="shrink-0 tabular-nums text-ink-soft">{x.created} → {x.won} won{x.credits ? ` · ${Math.round(x.credits)} cr` : ""}</span></div>
                <Bar v={x.created ? (x.won / x.created) * 100 : 0} tone="bg-fern" />
              </li>
            ))}
            {!s.bySource.length && <li className="p-3 text-small text-ink-soft">No source on these deals.</li>}
          </ul>
          <p className="mt-1 text-caption text-ink-faint">Bar = share of created deals that closed won in the same range.</p>
        </section>
      </div>
      <section className="mt-6">
        <h2 className="mb-2 text-lead font-extrabold">Won{sel ? ` in ${sel}` : ""} <span className="text-body font-semibold text-ink-soft">{wonList.length}</span></h2>
        <ul className="panel divide-y divide-line">
          {wonList.slice(0, 25).map((w, i) => <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-body"><span className="min-w-0 truncate">{w.name}</span><span className="shrink-0 tabular-nums text-ink-soft">{money(w.amount)} · {w.closedOn.slice(5).replace("-", "/")}</span></li>)}
          {!wonList.length && <li className="px-4 py-3 text-small text-ink-soft">Nothing won here in this range.</li>}
          {wonList.length > 25 && <li className="px-4 py-2 text-caption text-ink-faint">+{wonList.length - 25} more</li>}
        </ul>
      </section>
    </>
  );
}

export function PulseView({ p, q }: { p: Pulse; q: Q }) {
  const active = q.from ? "custom" : (q.r || "14d");
  const tile = (k: string) => p.tiles.find((t) => t.key === k)!;
  const TO: Record<string, string> = { care: "/a/dogs", update: "/a/chats", reply: "/a/chats", forms: "/a#todo-week", waiting: "/a#todo-now", sales: "/a/sales" };
  const keys = p.view === "clients" ? ["update", "reply", "waiting", "care"] : p.view === "trainers" ? ["update", "reply", "forms", "waiting"] : p.view === "office" ? ["forms", "waiting", "care", "sales"] : [];
  const cards = p.view === "sales" ? [] : p.cards.filter((c) => p.view === "office" || !/lost|price/i.test(c.title));
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

      <nav className="mb-4 grid grid-cols-4 rounded-2xl border border-line bg-white p-1 text-body font-semibold shadow-card sm:inline-grid sm:w-auto" aria-label="View">
        {VIEWS.map((v) => <Link key={v.key} prefetch={false} href={href(q, { v: v.key, state: undefined })} aria-current={p.view === v.key ? "page" : undefined} className={`flex items-center justify-center rounded-xl px-4 py-2.5 ${p.view === v.key ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>{v.label}</Link>)}
      </nav>

      {cards.length > 0 && (
        <section aria-label="Needs a decision" className="-mx-4 mb-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3">
          {cards.map((c, i) => <CardView key={i} c={c} />)}
        </section>
      )}

      {keys.length > 0 && (
        <section aria-label="The numbers" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {keys.map((k) => <TileCard key={k} t={tile(k)} to={TO[k]} />)}
        </section>
      )}

      {p.view === "clients" && p.clients && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-2 text-lead font-extrabold">In the app</h2>
            <div className="panel p-4">
              <p className="text-[28px] font-extrabold leading-none tabular-nums">{p.clients.chats ? Math.round((p.clients.joined / p.clients.chats) * 100) : 0}% <span className="text-body font-semibold text-ink-soft">of clients with a dog in care have opened their chat</span></p>
              <div className="mt-3"><Bar v={p.clients.chats ? (p.clients.joined / p.clients.chats) * 100 : 0} tone="bg-fern" /></div>
              <p className="mt-2 text-small text-ink-soft">{p.clients.joined} of {p.clients.chats}. Quiet (Signal) chats left out. <Link prefetch={false} href="/a/chats?j=no" className="font-semibold underline">See who hasn&apos;t</Link></p>
            </div>
          </section>
          <section>
            <h2 className="mb-2 text-lead font-extrabold">No word from Dogwise for 24 h+ <span className="text-body font-semibold text-ink-soft">{p.clients.silent24.length}</span></h2>
            <ul className="panel divide-y divide-line">
              {p.clients.silent24.slice(0, 12).map((x) => <li key={x.href}><Link prefetch={false} href={x.href} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-paper/60"><span className="min-w-0 truncate"><b>{x.dog}</b> <span className="text-ink-soft">· {x.client} · {x.trainer}</span></span><span className={`shrink-0 text-small font-semibold tabular-nums ${x.hours >= 48 ? "text-heart" : "text-warn"}`}>{x.hours} h</span></Link></li>)}
              {!p.clients.silent24.length && <li className="px-4 py-3 text-small text-ink-soft">Every client has heard from Dogwise in the last 24 hours.</li>}
            </ul>
          </section>
        </div>
      )}

      {p.view === "trainers" && (
        <section>
          <h2 className="mb-2 text-lead font-extrabold">Trainers</h2>
          <p className="mb-3 text-small text-ink-soft">Ranked by daily updates (lower confidence bound, so thin data doesn&apos;t win), then reply time. Quiet chats and days before the cutover don&apos;t count.</p>
          <Trainers rows={p.trainers} />
        </section>
      )}

      {p.view === "sales" && (p.sales ? <Sales s={p.sales} q={q} /> : <p className="text-body text-ink-soft">Sales needs HubSpot.</p>)}

      {p.view === "office" && p.office && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-2 text-lead font-extrabold">On the team&apos;s plate now</h2>
            <div className="grid grid-cols-2 gap-3">
              {([["To do", p.office.todo, "/a"], ["Need a person today", p.office.now, "/a#todo-now"], ["Forms to check", p.office.toReview, "/a#todo-week"], ["Forms late", p.office.lateForms, "/a#todo-week"], ["Closed Won, not booked", p.office.notBooked, "/a#todo-now"], ["Trainers not signed in", p.office.notSignedIn, "/a/trainers#signin"]] as [string, number, string][]).map(([l, n, h]) => (
                <Link key={l} prefetch={false} href={h} className="panel p-4 hover:bg-paper/60"><p className="text-small font-semibold text-ink-soft">{l}</p><p className={`mt-1 text-[28px] font-extrabold leading-none tabular-nums ${n ? "" : "text-ink-faint"}`}>{n}</p></Link>
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-2 text-lead font-extrabold">Today&apos;s list</h2>
            <ul className="panel divide-y divide-line">
              {p.office.items.map((i, k) => <li key={k}>{i.href ? <Link prefetch={false} href={i.href} className="block px-4 py-2.5 text-body hover:bg-paper/60">{i.text}</Link> : <span className="block px-4 py-2.5 text-body">{i.text}</span>}</li>)}
              {!p.office.items.length && <li className="px-4 py-3 text-small text-ink-soft">Nothing needs a person right now.</li>}
            </ul>
          </section>
        </div>
      )}

      {p.notes.length > 0 && <p className="mt-4 text-caption text-ink-faint">{p.notes.join(" ")}</p>}
    </>
  );
}
