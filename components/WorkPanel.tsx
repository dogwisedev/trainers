import { workReport } from "@/lib/work";

const mins = (m: number | null | undefined) => (m == null ? "" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`);
const people = (ps: string[]) => (ps.length ? ps.join(", ") : "");

/** Pulse → Where the work goes: what people did by hand in the range, office and trainers side by side, with the reasons
 *  they gave, what still happens in HubSpot, and what the app did on its own. For learning what to automate next. */
export async function WorkPanel({ from, to, label }: { from: string; to: string; label: string }) {
  const w = await workReport(from, to);
  const col = (title: string, rows: typeof w.office) => (
    <section className="panel overflow-hidden">
      <h3 className="border-b border-line bg-paper/60 px-4 py-2.5 text-body font-extrabold">{title}</h3>
      {rows.length ? <ul className="divide-y divide-line">{rows.map((r) => (
        <li key={r.what} className="flex items-start gap-3 px-4 py-2.5">
          <span className="w-12 shrink-0 text-right text-body font-bold tabular-nums">{r.n}</span>
          <span className="min-w-0 flex-1"><span className="block text-body">{r.what}</span><span className="block text-caption text-ink-faint">{people(r.people)}{r.medianMin != null ? ` · typically ${mins(r.medianMin)} after it came up` : ""}</span></span>
        </li>))}</ul> : <p className="px-4 py-3 text-small text-ink-soft">Nothing in this range.</p>}
    </section>
  );
  return (
    <div className="mt-2">
      <p className="mb-3 text-body text-ink-soft">What people did by hand, {label.toLowerCase()}. For learning what to automate next: counts and time, not judgements.</p>
      {w.note && <p className="mb-3 rounded-xl bg-biscuit-wash px-3 py-2 text-small font-semibold text-warn">{w.note}</p>}
      {w.rhythm.length > 0 && (
        <section className="panel mb-4 overflow-hidden">
          <h3 className="border-b border-line bg-paper/60 px-4 py-2.5 text-body font-extrabold">When the office does things <span className="font-normal text-ink-soft">(US Eastern, each square is an hour)</span></h3>
          <div className="overflow-x-auto px-4 py-3">
            <div className="min-w-[520px]">
              <div className="mb-1 flex items-end gap-3"><span className="w-28 shrink-0" /><div className="grid flex-1 grid-cols-24 gap-[3px] text-[10px] text-ink-faint" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>{Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 3 === 0 ? (h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`) : ""}</span>)}</div></div>
              {w.rhythm.map((r) => { const max = Math.max(...r.hours, 1); return (
                <div key={r.who} className="mb-3">
                  <div className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-small font-bold" title={r.who}>{r.who}</span>
                    <div className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                      {r.hours.map((n, h) => <span key={h} title={`${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? "am" : "pm"}: ${n} action${n === 1 ? "" : "s"}`} className="h-6 rounded-[4px]" style={{ background: n ? `rgba(91, 63, 208, ${0.15 + 0.85 * (n / max)})` : "var(--line, #e7e3f3)" }} />)}
                    </div>
                  </div>
                  <p className="ml-[124px] mt-1 text-caption text-ink-soft">{r.total} actions on {r.days} day{r.days === 1 ? "" : "s"} · busiest {r.busiest === 0 ? 12 : r.busiest > 12 ? r.busiest - 12 : r.busiest}{r.busiest < 12 ? "am" : "pm"} · <span className={r.burstPct >= 40 ? "font-semibold text-heart" : ""}>{r.burstPct}% within 10 seconds of the one before</span>{r.lateNightPct >= 25 ? ` · ${r.lateNightPct}% between 8pm and 6am` : ""}</p>
                </div>); })}
              <p className="text-caption text-ink-faint">Darker = more actions in that hour. &ldquo;Within 10 seconds&rdquo; is clicks in quick runs: normal for a batch of small things, worth a look when it&apos;s most of what someone does. Office people may be in other time zones.</p>
            </div>
          </div>
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-2">{col("Office, by hand", w.office)}{col("Trainers", w.trainers)}</div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="panel overflow-hidden">
          <h3 className="border-b border-line bg-paper/60 px-4 py-2.5 text-body font-extrabold">Why people overrode the app</h3>
          {w.reasons.length ? <ul className="divide-y divide-line">{w.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-2.5"><span className="w-12 shrink-0 text-right text-body font-bold tabular-nums">{r.n}</span><span className="min-w-0 flex-1"><span className="block text-body">{r.reason}</span><span className="block text-caption text-ink-faint">{r.action.replace(":", ": ")} · {people(r.people)}</span></span></li>))}</ul>
            : <p className="px-4 py-3 text-small text-ink-soft">No reasons yet: they&apos;re asked from now on when a form is marked not needed or missed, a To do item is closed by hand, or a client item is closed.</p>}
        </section>
        <section className="panel overflow-hidden">
          <h3 className="border-b border-line bg-paper/60 px-4 py-2.5 text-body font-extrabold">Still done in HubSpot by hand</h3>
          {w.hubspot.length ? <ul className="divide-y divide-line">{w.hubspot.map((r) => (
            <li key={r.property} className="flex items-start gap-3 px-4 py-2.5"><span className="w-12 shrink-0 text-right text-body font-bold tabular-nums">{r.n}</span><span className="min-w-0 flex-1"><span className="block text-body">{r.property.replace(/_/g, " ")}</span><span className="block text-caption text-ink-faint">{people(r.people)} · last {r.last.slice(0, 10)}</span></span></li>))}</ul>
            : <p className="px-4 py-3 text-small text-ink-soft">Nothing yet. Changes people make on deals in HubSpot are read once a day.</p>}
        </section>
      </div>
      {w.byItself.length > 0 && (
        <section className="panel mt-4 overflow-hidden">
          <h3 className="border-b border-line bg-paper/60 px-4 py-2.5 text-body font-extrabold">What the app did on its own, same range</h3>
          <ul className="divide-y divide-line">{w.byItself.map((r) => <li key={r.what} className="flex items-start gap-3 px-4 py-2.5"><span className="w-12 shrink-0 text-right text-body font-bold tabular-nums">{r.n}</span><span className="text-body">{r.what}</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}
