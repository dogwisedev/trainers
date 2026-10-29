import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Info } from "lucide-react";
import { Pill } from "@/components/ui";
import type { Card, Pulse, Tile, TrainerRow } from "@/lib/pulse";
import { PRESETS } from "@/lib/pulse";
import { minutesLabel } from "@/lib/pulseMath";

// Pulse: one screen. The range at the top, then what needs a decision, then the big numbers, then trainers and lost deals.
// Mobile first: cards scroll sideways, tiles are two across, the trainer table becomes a list.

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

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

function TileCard({ t }: { t: Tile }) {
  return (
    <div className="panel flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-small font-semibold text-ink-soft">{t.label}</p>
        <Delta t={t} />
      </div>
      <p className="mt-1 text-[32px] font-extrabold leading-none tabular-nums tracking-tight md:text-[36px]">{t.value}</p>
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
  const inner = (
    <>
      <p className={`text-body font-bold leading-snug ${text}`}>{c.title}</p>
      <p className="mt-1 text-small text-ink-soft">{c.evidence}</p>
      {c.action && <p className={`mt-2 inline-flex items-center gap-1 text-small font-semibold ${text}`}>{c.action}<ChevronRight size={14} /></p>}
    </>
  );
  const cls = `block w-[82vw] shrink-0 snap-start rounded-2xl border p-4 md:w-auto ${tone}`;
  return c.href ? <Link prefetch={false} href={c.href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

function Bar({ v, tone = "bg-lav" }: { v: number | null; tone?: string }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }} /></div>;
}

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

export function PulseView({ p, q }: { p: Pulse; q: { r?: string; from?: string; to?: string } }) {
  const active = q.from ? "custom" : (q.r || "14d");
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 font-extrabold leading-tight">Pulse <Pill tone="line">Preview</Pill></h1>
          <p className="text-body text-ink-soft">{p.range.label} · compared with the {p.range.days} days before</p>
        </div>
        <form className="flex flex-wrap items-center gap-2" method="get">
          {PRESETS.map((x) => <Link key={x.key} prefetch={false} href={`/a/pulse?r=${x.key}`} className={`rounded-full px-3 py-1.5 text-small font-semibold ${active === x.key ? "bg-ink text-white" : "border border-line bg-white text-ink-soft"}`}>{x.label}</Link>)}
          <span className="flex items-center gap-1">
            <input type="date" name="from" defaultValue={q.from || ""} className="field h-9 w-[9.5rem] px-2 text-small" aria-label="From" />
            <input type="date" name="to" defaultValue={q.to || ""} className="field h-9 w-[9.5rem] px-2 text-small" aria-label="To" />
            <button type="submit" className="btn-ghost h-9 min-h-0 px-3 text-small">Go</button>
          </span>
        </form>
      </div>

      <section aria-label="Needs a decision" className="-mx-4 mb-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3">
        {p.cards.map((c, i) => <CardView key={i} c={c} />)}
      </section>

      <section aria-label="The numbers" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        {p.tiles.map((t) => <TileCard key={t.key} t={t} />)}
      </section>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="trainers-h">
          <h2 id="trainers-h" className="mb-2 text-lead font-extrabold">Trainers</h2>
          <p className="mb-3 text-small text-ink-soft">Ranked by daily updates (lower confidence bound, so thin data doesn&apos;t win), then reply time. Quiet chats and days before the cutover don&apos;t count.</p>
          <Trainers rows={p.trainers} />
        </section>
        <section aria-labelledby="lost-h">
          <h2 id="lost-h" className="mb-2 text-lead font-extrabold">Lost deals</h2>
          {p.lost ? (
            <div className="panel p-4">
              <p className="text-[28px] font-extrabold leading-none tabular-nums">{p.lost.total} <span className="text-body font-semibold text-ink-soft">lost · {money(p.lost.amount)}</span></p>
              <p className="mt-1 text-small text-ink-soft">{p.lost.coverage} for lack of a nearby trainer ({money(p.lost.coverageAmount)})</p>
              <ul className="mt-3 space-y-2">
                {p.lost.reasons.map((r) => (
                  <li key={r.reason}>
                    <div className="flex justify-between gap-2 text-small"><span className="min-w-0 truncate">{r.reason}</span><span className="shrink-0 tabular-nums text-ink-soft">{r.n} · {money(r.amount)}</span></div>
                    <Bar v={p.lost!.total ? (r.n / p.lost!.total) * 100 : 0} tone={/local|trainers/i.test(r.reason) ? "bg-heart" : "bg-lav"} />
                  </li>
                ))}
              </ul>
              {p.lost.regions.length > 0 && <p className="mt-3 text-small text-ink-soft">Where there was no trainer: {p.lost.regions.map((x) => `${x.region} (${x.n})`).join(", ")}</p>}
              <p className="mt-2 text-caption text-ink-faint">From HubSpot, by close date: Closed lost, No Trainers Available and Cancelled/Refunded.</p>
            </div>
          ) : <p className="text-body text-ink-soft">Not available.</p>}
        </section>
      </div>
      {p.notes.length > 0 && <p className="mt-4 text-caption text-ink-faint">{p.notes.join(" ")}</p>}
    </>
  );
}
