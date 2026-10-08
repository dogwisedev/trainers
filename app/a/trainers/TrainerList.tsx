"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Avatar } from "@/components/ui";

export type Row = { id: string; name: string; place: string; state: string; cap: number; inNow: number; freeNow: number; away: boolean; opening: string; active: boolean; flags: number };

export function TrainerList({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const states = useMemo(() => [...new Set(rows.filter((r) => r.active).map((r) => r.state).filter(Boolean))].sort(), [rows]);
  const list = rows.filter((r) => (showInactive ? !r.active : r.active) && (!state || r.state === state) && (!q || `${r.name} ${r.place}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="sticky top-[60px] z-10 -mx-4 bg-paper/95 px-4 pb-3 pt-1 backdrop-blur md:top-0">
        <label className="relative block">
          <span className="sr-only">Search trainers</span>
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or city" className="field pl-10" />
        </label>
        <div className="-mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
          {["", ...states].map((s) => (
            <button key={s || "all"} onClick={() => setState(s)} className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${state === s ? "bg-ink text-white" : "border border-line bg-white"}`}>{s || "All states"}</button>
          ))}
          <button onClick={() => setShowInactive((x) => !x)} className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${showInactive ? "bg-heart text-white" : "border border-line bg-white text-ink-soft"}`}>Inactive</button>
        </div>
      </div>
      <p className="mb-2 text-[13px] text-ink-faint">{list.length} {showInactive ? "inactive" : "active"} trainer{list.length === 1 ? "" : "s"}</p>
      <ul className="grid gap-2.5 md:grid-cols-2">
        {list.map((r) => (
          <li key={r.id}>
            <Link href={`/a/trainers/${r.id}`} className="panel flex items-center gap-3.5 p-3.5 hover:border-ink-faint">
              <Avatar name={r.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{r.name}{r.flags > 0 && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-biscuit align-middle" aria-label="Has details to check" />}</p>
                <p className="truncate text-[13px] text-ink-soft">{r.place}</p>
                <p className="mt-1 text-[13px]">{r.away ? <span className="text-heart">Away this week</span> : <><span className="font-semibold">{r.freeNow} free</span><span className="text-ink-soft"> of {r.cap}. 3-week opening {r.opening}</span></>}</p>
              </div>
              <div className="flex flex-col-reverse gap-[3px]" aria-hidden>
                {Array.from({ length: Math.min(r.cap, 8) }, (_, i) => <span key={i} className={`h-2.5 w-2.5 rounded-[3px] ${r.away ? "kennel-blocked" : i < r.inNow ? "bg-ink" : i < r.cap - r.freeNow ? "kennel-blocked" : "bg-mint"}`} />)}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
