"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Info, MapPin, Navigation, Phone, X } from "lucide-react";
import { directionsUrl, telHref } from "@/lib/contactLinks";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check } from "lucide-react";
import { confirmMoveAction } from "@/app/actions";

/** Picked up / Dropped home, or Not yet (new day + why: the office is told). Big buttons: it's done standing at someone's door. */
function MoveConfirm({ v }: { v: Visit }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notYet, setNotYet] = useState(false), [day, setDay] = useState(""), [why, setWhy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const move = v.kind === "pickup" ? "pickup" : "dropoff";
  const run = (done: boolean) => start(async () => {
    let r = { ok: true, message: "" };
    for (const id of v.bookingIds) { r = await confirmMoveAction(id, move, done, day, why); if (!r.ok) break; }
    setMsg({ ok: r.ok, text: r.message }); if (r.ok) { setNotYet(false); router.refresh(); }
  });
  if (v.confirmed) return <p className="mt-3 flex items-center gap-1.5 text-body font-semibold text-fern"><Check size={17} />{v.kind === "pickup" ? "Picked up" : "Home"}: confirmed</p>;
  return (
    <div className="mt-3">
      {!notYet ? (
        <div className="grid grid-cols-[2fr_1fr] gap-2">
          <button type="button" disabled={pending} onClick={() => run(true)} className="btn-ink min-h-[52px] justify-center text-lead"><Check size={19} />{v.kind === "pickup" ? "Picked up" : "Dropped home"}</button>
          <button type="button" disabled={pending} onClick={() => setNotYet(true)} className="btn-ghost min-h-[52px] justify-center">Not yet</button>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-line bg-paper/60 p-3">
          <label className="block"><span className="label">New day, if you know it</span><input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="field h-11" /></label>
          <label className="block"><span className="label">What happened?</span><textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} className="field" placeholder="e.g. Client asked to move it to Saturday" /></label>
          <div className="flex gap-2"><button type="button" disabled={pending || !why.trim()} onClick={() => run(false)} className="btn-ink flex-1">Tell the office</button><button type="button" onClick={() => setNotYet(false)} className="btn-ghost">Back</button></div>
        </div>
      )}
      {msg && <p role="status" className={`mt-2 text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </div>
  );
}

export type Visit = { key: string; kind: "pickup" | "home"; dogs: string; bookingId: string; bookingIds: string[]; client: string; address: string; phone: string; day: string; today: string; confirmed: boolean; canConfirm: boolean };

function Row({ v }: { v: Visit }) {
  const tel = v.phone ? telHref(v.phone) : null;
  return (
    <li className="p-4">
      <p className={`text-caption font-bold uppercase tracking-wide ${v.day < v.today && !v.confirmed ? "text-heart" : "text-ink-faint"}`}>{v.day < v.today ? `${v.kind === "pickup" ? "Pickup" : "Home"} on ${new Date(`${v.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}: not confirmed yet` : v.kind === "pickup" ? "Pickup today" : "Going home today"}</p>
      <p className="text-lead font-extrabold">{v.dogs} <span className="font-semibold text-ink-soft">· {v.client}</span></p>
      {v.address ? <p className="mt-0.5 flex items-start gap-1.5 text-body text-ink-soft"><MapPin size={15} className="mt-1 shrink-0" />{v.address}</p> : <p className="mt-0.5 text-body text-ink-faint">No address in the client&apos;s forms yet: see Info.</p>}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {v.address ? <a href={directionsUrl(v.address)} target="_blank" rel="noopener" className="btn-ink min-h-[48px] justify-center px-2"><Navigation size={17} />Go</a> : <span className="btn-ghost pointer-events-none min-h-[48px] justify-center px-2 opacity-40"><Navigation size={17} />Go</span>}
        <a href={tel || undefined} aria-disabled={!tel} className={`btn-ghost min-h-[48px] justify-center px-2 ${tel ? "" : "pointer-events-none opacity-40"}`}><Phone size={17} />Call</a>
        <Link prefetch={false} href={`/t/dogs/${v.bookingId}`} className="btn-ghost min-h-[48px] justify-center px-2"><Info size={17} />Info</Link>
      </div>
      {v.canConfirm && <MoveConfirm v={v} />}
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
