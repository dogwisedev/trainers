"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PauseCircle } from "lucide-react";
import { postponeTrainingAction } from "@/app/actions";
import { POSTPONE_BY } from "@/lib/cancelReasons";

/** Dog page: Postpone. Frees the booking (the trainer is told) and puts the deal on Standby with a note and an optional reminder. */
export function PostponeTraining({ bookingId, dog }: { bookingId: string; dog: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [by, setBy] = useState(""), [note, setNote] = useState(""), [remind, setRemind] = useState(true);
  const [day, setDay] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!open) return (
    <span className="inline-flex flex-col">
      <button type="button" className="btn-ghost" onClick={() => { setOpen(true); setMsg(null); }}><PauseCircle size={16} />Postpone</button>
      {msg && <span className={`mt-1 text-caption ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</span>}
    </span>
  );
  return (
    <div className="w-full rounded-2xl border border-line bg-paper/60 p-4">
      <p className="text-lead font-bold">Postpone {dog}&apos;s training?</p>
      <p className="mt-1 text-body">The booking is freed and {dog}&apos;s trainer is told, like a cancellation. The deal goes on <b>Standby</b> (in HubSpot too), with your note, until it&apos;s booked again.</p>
      <label className="mt-3 block"><span className="label">Who asked?</span>
        <select className="field" value={by} onChange={(e) => setBy(e.target.value)}><option value="">Pick one…</option>{POSTPONE_BY.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      <label className="mt-3 block"><span className="label">What&apos;s the plan?</span>
        <textarea className="field min-h-[72px]" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Dog had surgery, client will call in December" /></label>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-body">
        <label className="flex items-center gap-2"><input type="radio" checked={remind} onChange={() => setRemind(true)} />Remind me on</label>
        <input type="date" value={day} onChange={(e) => { setDay(e.target.value); setRemind(true); }} className="field h-10 w-auto px-2" aria-label="Reminder day" />
        <label className="flex items-center gap-2"><input type="radio" checked={!remind} onChange={() => setRemind(false)} />No reminder</label>
      </div>
      {msg && !msg.ok && <p role="alert" className="mt-2 text-small font-semibold text-heart">{msg.text}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-ink" disabled={pending || !by || !note.trim()} onClick={() => start(async () => { const r = await postponeTrainingAction(bookingId, by, note, remind ? day : null); setMsg({ ok: r.ok, text: r.message }); if (r.ok) { setOpen(false); router.refresh(); } })}>{pending ? "Postponing…" : "Postpone"}</button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => setOpen(false)}>Keep it</button>
      </div>
    </div>
  );
}
