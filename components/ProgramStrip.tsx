import type { Dot, Strip } from "@/lib/programStrip";
import { DOT_LABEL } from "@/lib/programStrip";

// The program at a glance on each Dogs row: Intake · W1–W6 · Handover · FUP 1–3 · Paid. One small square each:
// green = in, amber = in late / asked for, red = missing, blue = booked, grey outline = not due yet, light grey = before the app.
const CLS: Record<Dot, string> = {
  in: "bg-fern text-white", late: "bg-biscuit text-white", missing: "bg-heart text-white", booked: "bg-lav text-white", asked: "bg-biscuit text-white",
  due: "border border-line text-ink-faint", old: "bg-paper text-ink-faint", na: "bg-paper text-ink-faint line-through"
};
const Sq = ({ d, t, label }: { d: Dot; t: string; label: string }) => (
  <span title={`${label}: ${DOT_LABEL[d]}`} aria-label={`${label}: ${DOT_LABEL[d]}`} className={`inline-grid h-5 min-w-5 place-items-center rounded px-1 text-[10px] font-bold leading-none ${CLS[d]}`}>{t}</span>
);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function ProgramStrip({ s }: { s: Strip }) {
  const owed = s.paid?.owed ?? null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5" aria-label="Program at a glance">
      <span className="flex items-center gap-0.5"><Sq d={s.intake} t="I" label="Intake form" /></span>
      {s.weeks.length > 0 && <span className="flex items-center gap-0.5">{s.weeks.map((d, i) => <Sq key={i} d={d} t={`W${i + 1}`} label={`Weekly report ${i + 1}`} />)}</span>}
      <span className="flex items-center gap-0.5"><Sq d={s.handover} t="H" label="Handover report" /></span>
      <span className="flex items-center gap-0.5">{s.fups.map((d, i) => <Sq key={i} d={d} t={`F${i + 1}`} label={`Follow-up ${i + 1}`} />)}</span>
      {s.paid && (owed != null
        ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${owed > 0 ? "bg-heart-wash text-heart" : "bg-mint-wash text-fern"}`} title={s.paid.status || ""}>{owed > 0 ? `${money(owed)} owed` : "Paid"}</span>
        : s.paid.status ? <span className="rounded bg-paper px-1.5 py-0.5 text-[10px] font-bold text-ink-soft">{s.paid.status}</span> : null)}
    </div>
  );
}
