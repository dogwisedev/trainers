"use client";
import { useEffect, useState } from "react";
import { Check, MapPin, Navigation, Route } from "lucide-react";
import { nearestTrainersAction } from "@/app/actions";

// Booking page: once the deal loads, the 5 closest trainers to the client (the same list and order as the Sales
// Assistant: covers the client and has room first), each with driving and straight-line miles, their next opening,
// and Pick. Picking fills the Trainer box below; the full list stays there for anyone else.
type T = { id: string; name: string; place: string; straight: number | null; route: number | null; range: number; inRange: boolean | null; opening: string; open: boolean; programs: string };

export function NearestTrainers({ zip, picked, onPick }: { zip: string; picked: string; onPick: (id: string) => void }) {
  const [st, setSt] = useState<{ busy: boolean; msg: string; place: string; list: T[] }>({ busy: true, msg: "", place: "", list: [] });
  useEffect(() => {
    let live = true;
    setSt({ busy: true, msg: "", place: "", list: [] });
    nearestTrainersAction(zip).then((r) => { if (!live) return; setSt(r.ok ? { busy: false, msg: "", place: r.place, list: r.trainers as T[] } : { busy: false, msg: r.message, place: "", list: [] }); })
      .catch(() => live && setSt({ busy: false, msg: "Couldn't load the closest trainers. Pick from the list below.", place: "", list: [] }));
    return () => { live = false; };
  }, [zip]);
  return (
    <section className="rounded-2xl border border-line bg-paper/60 p-3" aria-label="Closest trainers">
      <p className="mb-2 flex items-center gap-1.5 text-small font-semibold text-ink-soft"><MapPin size={14} />Closest to ZIP {zip}{st.place ? ` (${st.place})` : ""}</p>
      {st.busy && <ul className="space-y-2" aria-hidden>{[0, 1, 2].map((i) => <li key={i} className="skeleton h-[72px] rounded-xl" />)}</ul>}
      {!st.busy && st.msg && <p className="text-small text-ink-soft">{st.msg}</p>}
      {!st.busy && st.list.length > 0 && (
        <ul className="space-y-2">
          {st.list.map((t, i) => {
            const on = picked === t.id, far = t.inRange === false;
            return (
              <li key={t.id}>
                <button type="button" onClick={() => onPick(t.id)} aria-pressed={on}
                  className={`flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left ${on ? "border-ink ring-2 ring-ink" : "border-line hover:border-ink-faint"}`}>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-small font-bold ${on ? "bg-ink text-white" : "bg-paper text-ink-soft"}`}>{on ? <Check size={16} /> : i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{t.name}</span>
                    <span className="block truncate text-small text-ink-soft">{t.place}{t.programs && !/^all programs?$/i.test(t.programs) ? ` · ${t.programs.replace(/\*[^,]*/g, "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 2).join(", ")}` : ""}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-small tabular-nums">
                      <span className={`inline-flex items-center gap-1 font-semibold ${far ? "text-heart" : ""}`}><Route size={13} />{t.route != null ? `Route ${Math.round(t.route)} mi` : "Route –"}</span>
                      <span className="inline-flex items-center gap-1 text-ink-soft"><Navigation size={12} />Straight {t.straight ?? "–"} mi</span>
                      <span className="text-ink-faint">covers {t.range} mi</span>
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-lg px-2 py-1 text-caption font-bold ${t.open ? "bg-mint-wash text-fern" : "bg-paper text-ink-faint"}`}>{t.opening}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-caption text-ink-faint">Same order as the Sales Assistant: covers the client and has room first. Route = driving miles one way from the trainer to the client&apos;s ZIP; straight = as the crow flies. Red = outside the trainer&apos;s range.</p>
    </section>
  );
}
