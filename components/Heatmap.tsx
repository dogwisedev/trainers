import Link from "next/link";
import { WeekUse } from "@/lib/capacity";
import { short } from "@/lib/dates";
import { Trainer } from "@/lib/types";

/** Every active trainer against the coming weeks. Cell = free kennels; colour = how full. */
export function Heatmap({ rows, weeks }: { rows: { t: Trainer; use: WeekUse[] }[]; weeks: string[] }) {
  const tone = (w: WeekUse) => {
    if (w.cap === 0 || w.blocked >= w.cap) return "kennel-blocked text-heart";
    if (w.free === 0) return "bg-ink text-white";
    if (w.free / w.cap <= 0.34) return "bg-mint-deep text-ink";
    return "bg-mint text-ink";
  };
  return (
    <div className="panel overflow-hidden">
      <div className="max-h-[70dvh] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              <th className="sticky left-0 z-10 bg-white px-3 py-2.5 text-left font-semibold">Trainer</th>
              {weeks.map((w, i) => <th key={w} className="px-1 py-2.5 text-center font-medium text-ink-faint">{i === 0 ? "Now" : short(w)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ t, use }) => (
              <tr key={t.id}>
                <th scope="row" className="sticky left-0 z-[1] max-w-[150px] border-t border-line bg-white px-3 py-1.5 text-left font-medium">
                  <Link href={`/a/trainers/${t.id}`} className="block truncate hover:underline">{t.name}</Link>
                  <span className="block text-[11px] font-normal text-ink-faint">{t.state}, {t.capacity} dogs</span>
                </th>
                {use.map((w) => (
                  <td key={w.week} className="border-t border-line p-[3px]">
                    <span className={`grid h-9 min-w-[34px] place-items-center rounded-[9px] font-bold ${tone(w)}`} title={`${short(w.week)}: ${w.dogs.length} in, ${w.free} free`}>
                      {w.cap === 0 || w.blocked >= w.cap ? "" : w.free}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2.5 text-[12px] text-ink-soft">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-mint" />Plenty free</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-mint-deep" />Nearly full</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-ink" />Full</span>
        <span className="inline-flex items-center gap-1.5"><span className="kennel-blocked h-3 w-3 rounded" />Away</span>
        <span>Numbers are free kennels that week.</span>
      </div>
    </div>
  );
}
