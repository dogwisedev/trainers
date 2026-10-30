import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import type { Move } from "@/lib/moves";

const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** Pickups and drop-offs as a compact list. `today` hides the dates (they're all today). */
export function MovesStrip({ moves, title, today = false, limit }: { moves: Move[]; title: string; today?: boolean; limit?: number }) {
  const picks = moves.filter((m) => m.kind === "pickup").length, drops = moves.length - picks;
  const shown = limit ? moves.slice(0, limit) : moves;
  return (
    <section className="panel overflow-hidden" aria-label={title}>
      <div className="flex items-baseline justify-between gap-2 border-b border-line bg-paper/60 px-4 py-2.5">
        <h2 className="text-body font-extrabold">{title}</h2>
        <p className="text-small text-ink-soft">{picks} pickup{picks === 1 ? "" : "s"} · {drops} drop-off{drops === 1 ? "" : "s"}</p>
      </div>
      {moves.length ? (
        <ul className="divide-y divide-line">
          {shown.map((m) => (
            <li key={`${m.id}-${m.kind}`}>
              <Link prefetch={false} href={`/a/dogs/${m.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper/60">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${m.kind === "pickup" ? "bg-mint-wash text-fern" : "bg-biscuit-wash text-warn"}`} aria-hidden>{m.kind === "pickup" ? <ArrowUpFromLine size={15} /> : <ArrowDownToLine size={15} />}</span>
                <span className="min-w-0 flex-1 truncate"><b>{m.dog}</b> <span className="text-ink-soft">· {m.client}{m.trainer ? ` · ${m.trainer}` : ""}</span></span>
                <span className="shrink-0 text-small text-ink-soft">{m.kind === "pickup" ? "Pickup" : "Drop-off"}{today ? "" : ` · ${short(m.date)}`}</span>
              </Link>
            </li>
          ))}
          {shown.length < moves.length && <li className="px-4 py-2 text-caption text-ink-faint">+{moves.length - shown.length} more</li>}
        </ul>
      ) : <p className="px-4 py-3 text-small text-ink-soft">No pickups or drop-offs{today ? " today" : " in this range"}.</p>}
    </section>
  );
}
