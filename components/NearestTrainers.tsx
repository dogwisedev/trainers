"use client";
import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Check, MapPin, Navigation, Route, ShieldQuestion, Star } from "lucide-react";
import { askAction, nearestTrainersAction } from "@/app/actions";
import type { DealCtx, LaneRow } from "@/lib/laneData";

// Booking page: the closest trainers for this deal, each in its lane (OPS 08 · Assign or Ask):
//  Assign        Pick and Book now.
//  Check first   a bonus dog, short notice or Watch: "They said yes" → pick, or "Ask them for me" → To do for the POC.
//  Ask Pedro     probation or out of range: a To do for Pedro with the details; once he approves, it's bookable.
//  Greyed        doesn't take this program.  (On Hold: not shown.)
// A small ★ Preferred only on a genuine tie (same lane, both free, about the same distance): fewer alerts wins.
export function NearestTrainers({ ctx, picked, onPick }: { ctx: DealCtx; picked: string; onPick: (id: string, laneOk: "" | "offer") => void }) {
  const [st, setSt] = useState<{ busy: boolean; msg: string; place: string; list: LaneRow[] }>({ busy: true, msg: "", place: "", list: [] });
  const [open, setOpen] = useState(""), [note, setNote] = useState(""), [done, setDone] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const key = JSON.stringify([ctx.dealId, ctx.zip, ctx.start, ctx.end, ctx.program, ctx.dogs]);
  useEffect(() => {
    let live = true;
    setSt({ busy: true, msg: "", place: "", list: [] });
    nearestTrainersAction(ctx).then((r) => { if (!live) return; setSt(r.ok ? { busy: false, msg: "", place: r.place, list: r.rows } : { busy: false, msg: r.message, place: "", list: [] }); })
      .catch(() => live && setSt({ busy: false, msg: "Couldn't load the closest trainers. Pick from the list below.", place: "", list: [] }));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const ask = (kind: "offer" | "pedro", id: string) => start(async () => { const r = await askAction(kind, ctx, id, note); setDone((d) => ({ ...d, [id]: r.message })); if (r.ok) { setOpen(""); setNote(""); } });
  const until = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "");
  return (
    <section className="rounded-2xl border border-line bg-paper/60 p-3" aria-label="Closest trainers">
      <p className="mb-2 flex items-center gap-1.5 text-small font-semibold text-ink-soft"><MapPin size={14} />Closest to ZIP {ctx.zip}{st.place ? ` (${st.place})` : ""}{!ctx.start ? " · add the start date to check kennels and notice" : ""}</p>
      {st.busy && <ul className="space-y-2" aria-hidden>{[0, 1, 2].map((i) => <li key={i} className="skeleton h-[84px] rounded-xl" />)}</ul>}
      {!st.busy && st.msg && <p className="text-small text-ink-soft">{st.msg}</p>}
      {!st.busy && st.list.length > 0 && (
        <ul className="space-y-2">
          {st.list.map((t) => {
            const on = picked === t.id, grey = t.lane === "blocked";
            const tone = t.lane === "assign" ? "border-ok/40" : t.lane === "offer" ? "border-amber/50" : t.lane === "pedro" ? "border-bad/40" : "border-line";
            return (
              <li key={t.id} className={`rounded-xl border bg-white ${on ? "ring-2 ring-ink" : ""} ${tone} ${grey ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-3 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5"><b className="truncate">{t.name}</b>{t.preferred && <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-wash px-1.5 py-0.5 text-[10px] font-bold text-amber" title="A tie on distance and availability: the more responsive trainer"><Star size={10} className="fill-current" />Preferred</span>}</span>
                    <span className="block truncate text-small text-ink-soft">{t.place} · opening {t.opening}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-small tabular-nums">
                      <span className="inline-flex items-center gap-1 font-semibold"><Route size={13} />{t.route != null ? `${Math.round(t.route)} mi drive` : "drive –"}</span>
                      <span className="inline-flex items-center gap-1 text-ink-soft"><Navigation size={12} />{t.straight ?? "–"} mi straight</span>
                      <span className="text-ink-faint">covers {t.range} mi</span>
                    </span>
                    {t.reasons.length > 0 && <span className={`mt-1 block text-small font-semibold ${t.lane === "pedro" ? "text-bad" : t.lane === "offer" ? "text-amber" : "text-ink-soft"}`}>{t.reasons.map((r) => r.text).join(" · ")}</span>}
                    {t.ask && <span className="mt-1 block text-caption font-semibold text-ink-soft">{t.ask.kind === "pedro" ? `Waiting on Pedro since ${until(t.ask.created_at)}` : `Asked: answer by ${until(t.ask.deadline)}`}</span>}
                    {done[t.id] && <span className="mt-1 block text-caption font-semibold text-ok">{done[t.id]}</span>}
                  </span>
                  <span className="shrink-0">
                    {t.lane === "assign" && <button type="button" onClick={() => onPick(t.id, "")} className={`h-9 min-h-0 px-3 text-small ${on ? "btn-ink" : "btn-ghost"}`}>{on ? <><Check size={15} />Picked</> : "Pick"}</button>}
                    {t.lane === "offer" && <button type="button" onClick={() => setOpen(open === t.id ? "" : t.id)} className="btn-ghost h-9 min-h-0 border-amber/60 px-3 text-small"><AlertTriangle size={14} className="text-amber" />Check first</button>}
                    {t.lane === "pedro" && <button type="button" onClick={() => setOpen(open === t.id ? "" : t.id)} disabled={!!t.ask} className="btn-ghost h-9 min-h-0 border-bad/50 px-3 text-small"><ShieldQuestion size={14} className="text-bad" />Ask Pedro</button>}
                  </span>
                </div>
                {open === t.id && t.lane === "offer" && (
                  <div className="border-t border-line bg-amber-wash/50 p-3 text-small">
                    <p className="font-semibold">Check with {t.name.split(" ")[0]} before booking{t.hours ? `: answer within ${t.hours} hours` : ""}{t.reasons.some((r) => r.call) ? `, call ${t.reasons.find((r) => r.call)?.call?.toLowerCase()}` : ""}.</p>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the To do (optional)" className="field-sm mt-2" />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => { onPick(t.id, "offer"); setOpen(""); }} className="btn-ink h-9 min-h-0 px-3 text-small"><Check size={15} />They said yes: pick</button>
                      <button type="button" disabled={pending || !!t.ask} onClick={() => ask("offer", t.id)} className="btn-ghost h-9 min-h-0 px-3 text-small">Ask them for me (To do)</button>
                    </div>
                  </div>
                )}
                {open === t.id && t.lane === "pedro" && (
                  <div className="border-t border-line bg-bad-wash/40 p-3 text-small">
                    <p className="font-semibold">Pedro decides this one. He gets a To do and an email with the dog, program, dates, distance and why.</p>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything he should know? e.g. the client can meet at the I-95 exit" className="field-sm mt-2" />
                    <button type="button" disabled={pending} onClick={() => ask("pedro", t.id)} className="btn-ink mt-2 h-9 min-h-0 px-3 text-small">{pending ? "Sending…" : "Ask Pedro"}</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-caption text-ink-faint">Green: book it and tell the trainer. Amber: check with the trainer first. Red: Pedro decides. ★ only on a tie.</p>
    </section>
  );
}
