"use client";
import { useState, useTransition } from "react";
import { cancelTrainingAction } from "@/app/actions";
import { CANCEL_REASONS } from "@/lib/cancelReasons";

/** Dog page: Cancel training, with why, and a plain warning about who gets told. */
export function CancelTraining({ bookingId, dog, trainer }: { bookingId: string; dog: string; trainer: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const needNote = reason === "Other" && !note.trim();
  if (!open) return (
    <span className="inline-flex flex-col">
      <button type="button" className="btn-danger" onClick={() => { setOpen(true); setMsg(null); }}>Cancel training</button>
      {msg && <span className={`mt-1 text-caption ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</span>}
    </span>
  );
  return (
    <div className="w-full rounded-2xl border border-heart/30 bg-heart-wash p-4">
      <p className="text-lead font-bold text-heart">Cancel {dog}&apos;s training?</p>
      <p className="mt-1 text-body">This emails everyone about it being cancelled: {trainer} gets a cancellation with a calendar removal, and the office is told to sort the refund or partial pay. The kennel frees up straight away.</p>
      <p className="mt-1 text-body font-semibold">Only use it for a training that was really cancelled.</p>
      <label className="mt-3 block"><span className="label">Why was it cancelled?</span>
        <select className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Pick one…</option>
          {CANCEL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <label className="mt-3 block"><span className="label">More detail{reason === "Other" ? "" : " (optional)"}</span>
        <textarea className="field min-h-[72px]" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Moving house, will rebook in spring" />
      </label>
      <p className="mt-2 text-small text-ink-soft">The reason goes to the office and stays on the booking. It isn&apos;t in the trainer&apos;s email.</p>
      {msg && !msg.ok && <p role="alert" className="mt-2 text-small font-semibold text-heart">{msg.text}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-danger" disabled={pending || !reason || needNote}
          onClick={() => start(async () => { const r = await cancelTrainingAction(bookingId, reason, note); setMsg({ ok: r.ok, text: r.message }); if (r.ok) setOpen(false); })}>
          {pending ? "Cancelling…" : "Cancel the training"}
        </button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => setOpen(false)}>Keep it</button>
      </div>
    </div>
  );
}
