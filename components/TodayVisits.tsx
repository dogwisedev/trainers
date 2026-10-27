"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Info, MapPin, Navigation, Phone, X } from "lucide-react";
import { directionsUrl, telHref } from "@/lib/contactLinks";

export type Visit = { key: string; kind: "pickup" | "home"; dogs: string; bookingId: string; client: string; address: string; phone: string };

function Row({ v }: { v: Visit }) {
  const tel = v.phone ? telHref(v.phone) : null;
  return (
    <li className="p-4">
      <p className="text-caption font-bold uppercase tracking-wide text-ink-faint">{v.kind === "pickup" ? "Pickup today" : "Going home today"}</p>
      <p className="text-lead font-extrabold">{v.dogs} <span className="font-semibold text-ink-soft">· {v.client}</span></p>
      {v.address ? <p className="mt-0.5 flex items-start gap-1.5 text-body text-ink-soft"><MapPin size={15} className="mt-1 shrink-0" />{v.address}</p> : <p className="mt-0.5 text-body text-ink-faint">No address in the client&apos;s forms yet: see Info.</p>}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {v.address ? <a href={directionsUrl(v.address)} target="_blank" rel="noopener" className="btn-ink min-h-[48px] justify-center px-2"><Navigation size={17} />Go</a> : <span className="btn-ghost pointer-events-none min-h-[48px] justify-center px-2 opacity-40"><Navigation size={17} />Go</span>}
        <a href={tel || undefined} aria-disabled={!tel} className={`btn-ghost min-h-[48px] justify-center px-2 ${tel ? "" : "pointer-events-none opacity-40"}`}><Phone size={17} />Call</a>
        <Link prefetch={false} href={`/t/dogs/${v.bookingId}`} className="btn-ghost min-h-[48px] justify-center px-2"><Info size={17} />Info</Link>
      </div>
    </li>
  );
}

/** Today's pickups and drop-offs: a card on Today, and a pop-up the first time the app is opened that day. */
export function TodayVisits({ visits, today }: { visits: Visit[]; today: string }) {
  const [open, setOpen] = useState(false);
  const key = `dw-today-seen:${today}`;
  useEffect(() => {
    if (!visits.some((v) => v.kind === "pickup")) return;
    try { if (!localStorage.getItem(key)) setOpen(true); } catch { /* private mode: card only */ }
  }, [key, visits]);
  const close = () => { setOpen(false); try { localStorage.setItem(key, "1"); } catch { /* ignore */ } };
  if (!visits.length) return null;
  return (
    <>
      <section className="panel mb-4 overflow-hidden border-lav/50" aria-label="Today">
        <h2 className="border-b border-line bg-paper/60 px-4 py-3 text-lead font-extrabold">Today: {visits.length} {visits.length === 1 ? "visit" : "visits"}</h2>
        <ul className="divide-y divide-line">{visits.map((v) => <Row key={v.key} v={v} />)}</ul>
      </section>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center" onClick={close}>
          <div role="dialog" aria-modal="true" aria-label="Pickups today" className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-[24px] bg-white pb-[max(12px,env(safe-area-inset-bottom))] shadow-lift" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-h3 font-extrabold">Pickups today</p>
              <button type="button" onClick={close} className="grid h-11 w-11 place-items-center rounded-full hover:bg-paper" aria-label="Close"><X size={20} /></button>
            </div>
            <ul className="divide-y divide-line">{visits.filter((v) => v.kind === "pickup").map((v) => <Row key={v.key} v={v} />)}</ul>
            <div className="px-4 pt-2"><button type="button" onClick={close} className="btn-ghost w-full">Got it</button></div>
          </div>
        </div>
      )}
    </>
  );
}
