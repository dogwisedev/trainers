"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extendStayAction, removeMistakeAction } from "@/app/stay-actions";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Dog page: Extend. A new drop-off date (written to HubSpot too), paid at the usual day rate, or pro bono: tracked, not paid. */
export function ExtendStay({ bookingId, dog, trainer, end, maxEnd }: { bookingId: string; dog: string; trainer: string; end: string; maxEnd: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [to, setTo] = useState(""), [free, setFree] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const first = trainer.split(" ")[0], added = to && to > end ? between(end, to) : 0;
  if (!open) return (
    <span className="inline-flex flex-col">
      <button type="button" className="btn-ghost" onClick={() => { setOpen(true); setMsg(null); }}>Extend</button>
      {msg && <span className={`mt-1 max-w-md text-caption ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</span>}
    </span>
  );
  return (
    <div className="w-full rounded-2xl border border-line bg-paper p-4">
      <p className="text-lead font-bold">Extend {dog}&apos;s stay</p>
      <p className="mt-1 text-body text-ink-soft">Drop-off is {day(end)} now. The new date goes to HubSpot and to {first}&apos;s calendar, and the kennel stays taken until then.</p>
      <label className="mt-3 block"><span className="label">New drop-off date</span>
        <input type="date" className="field" value={to} min={plus(end, 1)} max={maxEnd} onChange={(e) => setTo(e.target.value)} /></label>
      <label className="mt-3 flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border border-line bg-white px-3.5 py-3 text-body">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={free} onChange={(e) => setFree(e.target.checked)} />
        <span><b>Pro bono</b>: {first} is keeping {dog} for free. The extra days are tracked but not paid.</span>
      </label>
      {added > 0 && <p className="mt-2 text-body font-semibold">{added} more day{added === 1 ? "" : "s"}: {free ? `not on ${first}'s payslip` : `paid at ${first}'s usual day rate`}.</p>}
      {msg && !msg.ok && <p role="alert" className="mt-2 text-small font-semibold text-heart">{msg.text}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-ink" disabled={pending || !added} onClick={() => start(async () => { const r = await extendStayAction(bookingId, to, free); setMsg({ ok: r.ok, text: r.message }); if (r.ok) { setOpen(false); setTo(""); setFree(false); router.refresh(); } })}>{pending ? "Saving…" : "Extend"}</button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => setOpen(false)}>Leave it</button>
      </div>
    </div>
  );
}

/** Dog page, before pickup: take away a booking that was made by mistake. Quiet: no HubSpot change, no alert, no client email. */
export function RemoveMistake({ bookingId, dog, trainer, after }: { bookingId: string; dog: string; trainer: string; after: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [tell, setTell] = useState(true), [why, setWhy] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const first = trainer.split(" ")[0];
  if (!open) return <button type="button" className="font-semibold text-ink-soft underline" onClick={() => setOpen(true)}>Booked by mistake? Remove it</button>;
  return (
    <div className="w-full rounded-2xl border border-line bg-paper p-4">
      <p className="text-lead font-bold">Remove {dog}&apos;s booking with {trainer}?</p>
      <p className="mt-1 text-body text-ink-soft">For a booking that should never have been made (the wrong trainer, booked twice). The booking and its empty forms are deleted. Nothing goes to HubSpot, the client or Sean, and if the deal is also booked with another trainer, the chat moves to them. It&apos;s kept in the activity log.</p>
      <label className="mt-3 flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border border-line bg-white px-3.5 py-3 text-body">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={tell} onChange={(e) => setTell(e.target.checked)} />
        <span>Take it off {first}&apos;s calendar (emails {first} a cancellation)</span>
      </label>
      <label className="mt-3 block"><span className="label">What was the mistake?</span>
        <input className="field" value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Booked again on Jarret instead of using Change trainer" /></label>
      {msg && <p role="alert" className="mt-2 text-small font-semibold text-heart">{msg}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-danger" disabled={pending || why.trim().length < 5} onClick={() => start(async () => { const r = await removeMistakeAction(bookingId, tell, why); if (r.ok) { router.push(after); router.refresh(); } else setMsg(r.message); })}>{pending ? "Removing…" : "Remove the booking"}</button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => setOpen(false)}>Keep it</button>
      </div>
    </div>
  );
}
