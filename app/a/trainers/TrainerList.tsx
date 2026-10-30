"use client";
import Link from "next/link";
import { useMemo, useState, useRef } from "react";
import { Search, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/ui";

export type Row = { id: string; name: string; place: string; state: string; cap: number; inNow: number; freeNow: number; away: boolean; opening: string; active: boolean; flags: number };

export function TrainerList({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const chips = useRef<HTMLDivElement>(null);
  const states = useMemo(() => [...new Set(rows.filter((r) => r.active).map((r) => r.state).filter(Boolean))].sort(), [rows]);
  const matches = (r: Row) => (!state || r.state === state) && (!q || `${r.name} ${r.place}`.toLowerCase().includes(q.toLowerCase()));
  // A state picked: active trainers first, then that state's inactive ones at the bottom, marked. "Inactive" lists every inactive trainer.
  const active = rows.filter((r) => r.active && matches(r)), inactive = rows.filter((r) => !r.active && matches(r));
  const list = showInactive ? inactive : state ? [...active, ...inactive] : active;
  return (
    <>
      <div className="sticky top-[60px] z-10 -mx-4 bg-paper/95 px-4 pb-3 pt-1 backdrop-blur md:top-0">
        <label className="relative block">
          <span className="sr-only">Search trainers</span>
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or city" className="field pl-10" />
        </label>
        <div className="relative -mx-4 mt-2.5">
          <div ref={chips} className="flex gap-1.5 overflow-x-auto px-4 pr-14 [scrollbar-width:none]">
            {["", ...states].map((s) => (
              <button key={s || "all"} onClick={() => setState(s)} className={`shrink-0 rounded-full px-3.5 py-1.5 text-small font-semibold ${state === s ? "bg-ink text-white" : "border border-line bg-white"}`}>{s || "All states"}</button>
            ))}
            <button onClick={() => setShowInactive((x) => !x)} className={`shrink-0 rounded-full px-3.5 py-1.5 text-small font-semibold ${showInactive ? "bg-heart text-white" : "border border-line bg-white text-ink-soft"}`}>Inactive</button>
          </div>
          {/* The row scrolls sideways; this makes that obvious and works for a mouse too */}
          <button type="button" aria-label="More states" onClick={() => chips.current?.scrollBy({ left: 240, behavior: "smooth" })}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-ink shadow-card">
            <ChevronRight size={16} />
          </button>
          <div className="pointer-events-none absolute right-10 top-0 h-full w-8 bg-gradient-to-r from-transparent to-paper/95" aria-hidden />
        </div>
      </div>
      <p className="mb-2 text-small text-ink-faint">{showInactive ? `${list.length} inactive trainer${list.length === 1 ? "" : "s"}` : `${active.length} active trainer${active.length === 1 ? "" : "s"}${state && inactive.length ? `, ${inactive.length} inactive in ${state} at the bottom` : ""}`}</p>
      <ul className="grid gap-2.5 md:grid-cols-2">
        {list.map((r) => (
          <li key={r.id}>
            <Link prefetch={false} href={`/a/trainers/${r.id}`} className={`panel flex items-center gap-3.5 p-3.5 hover:border-ink-faint ${r.active ? "" : "opacity-70"}`}>
              <Avatar name={r.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{r.name}{!r.active && <span className="ml-1.5 rounded-full bg-paper px-2 py-0.5 text-caption font-semibold text-ink-soft align-middle">Inactive</span>}{r.flags > 0 && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-biscuit align-middle" aria-label="Has details to check" />}</p>
                <p className="truncate text-small text-ink-soft">{r.place}</p>
                <p className="mt-1 text-small">{r.away ? <span className="text-heart">Away this week</span> : <><span className="font-semibold">{r.freeNow} free</span><span className="text-ink-soft"> of {r.cap}. 3-week opening {r.opening}</span></>}</p>
              </div>
              <div className="flex flex-col-reverse gap-[3px]" aria-hidden>
                {Array.from({ length: Math.min(r.cap, 8) }, (_, i) => <span key={i} className={`h-2.5 w-2.5 rounded-[3px] ${r.away ? "kennel-blocked" : i < r.inNow ? "bg-ink" : i < r.cap - r.freeNow ? "kennel-blocked" : "bg-mint dark:bg-transparent dark:ring-1 dark:ring-inset dark:ring-lav"}`} />)}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
