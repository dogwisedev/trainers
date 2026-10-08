import { WeekUse } from "@/lib/capacity";
import { short, todayIso, weekStart } from "@/lib/dates";

/**
 * The signature visual: one column per week, one kennel per dog the trainer can take.
 * Navy kennel = dog in training (shows the dog's initial), striped = time off, mint = free.
 */
export function KennelStrip({ use, compact = false }: { use: WeekUse[]; compact?: boolean }) {
  const thisWeek = weekStart(todayIso());
  const size = compact ? 14 : 22;
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      <ol className="flex min-w-max items-end gap-2" aria-label="Kennels by week">
        {use.map((w) => {
          const cells = [
            ...w.dogs.slice(0, w.cap).map((d) => ({ kind: "dog" as const, label: (d.dog_name || d.client_name || "?")[0] })),
            ...Array.from({ length: w.blocked }, () => ({ kind: "off" as const, label: "" })),
            ...Array.from({ length: w.free }, () => ({ kind: "free" as const, label: "" }))
          ].slice(0, Math.max(w.cap, w.dogs.length));
          const over = w.dogs.length > w.cap - w.blocked;
          const now = w.week === thisWeek;
          return (
            <li key={w.week} className="flex flex-col items-center gap-1.5" title={`${short(w.week)}: ${w.dogs.length} dogs, ${w.free} free${w.blocked ? `, ${w.blocked} blocked` : ""}`}>
              <div className={`flex flex-col-reverse gap-1 rounded-[14px] p-1.5 ${now ? "bg-biscuit-wash ring-2 ring-biscuit" : over ? "bg-heart-wash" : "bg-paper"}`}>
                {cells.map((c, i) => (
                  <span key={i} style={{ width: size, height: size }}
                    className={`grid place-items-center rounded-[7px] text-[10px] font-bold ${c.kind === "dog" ? "bg-ink text-white" : c.kind === "off" ? "kennel-blocked" : "bg-mint"}`}>
                    {!compact && c.label}
                  </span>
                ))}
                {w.cap === 0 && <span style={{ width: size, height: size }} className="rounded-[7px] border border-dashed border-line" />}
              </div>
              <span className={`text-[11px] ${now ? "font-bold text-ink" : "text-ink-faint"}`}>{now ? "Now" : short(w.week)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function KennelLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-soft">
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-[4px] bg-ink" />Dog in training</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-[4px] bg-mint" />Free kennel</span>
      <span className="inline-flex items-center gap-1.5"><span className="kennel-blocked h-3 w-3 rounded-[4px]" />Time off</span>
    </div>
  );
}
