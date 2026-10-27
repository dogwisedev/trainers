"use client";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { changeTrainerAction } from "@/app/actions";

const nice = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Admin: give the dog to another trainer. Before pickup the whole booking moves; mid-training it's split on a date. */
export function ChangeTrainer({ bookingId, dog, current, start, end, today, trainers }: {
  bookingId: string; dog: string; current: string; start: string; end: string; today: string; trainers: { id: string; name: string }[];
}) {
  const [r, act] = useFormState(changeTrainerAction, null);
  const [open, setOpen] = useState(false);
  const started = today > start;
  const [whole, setWhole] = useState(!started);
  const [from, setFrom] = useState(started ? today : start);
  const [to, setTo] = useState("");
  const toName = trainers.find((t) => t.id === to)?.name || "the new trainer";
  if (!open) return <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>Change trainer</button>;
  const day = whole ? start : from;
  return (
    <form action={act} className="w-full space-y-3 rounded-2xl border border-line bg-canvas p-3.5"
      onSubmit={(e) => { if (!window.confirm(whole ? `Move ${dog} from ${current} to ${toName}?` : `${current} keeps ${dog} until ${nice(day)}, then ${toName} to ${nice(end)}. Go ahead?`)) e.preventDefault(); }}>
      <input type="hidden" name="booking_id" value={bookingId} />
      <input type="hidden" name="from" value={day} />
      <label className="block"><span className="label">New trainer</span>
        <select name="trainer_id" required value={to} onChange={(e) => setTo(e.target.value)} className="field">
          <option value="">Choose a trainer</option>
          {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {started ? (
        <fieldset className="space-y-2">
          <legend className="label">{dog} is already with {current}</legend>
          <label className="flex items-start gap-2 text-body"><input type="radio" checked={!whole} onChange={() => setWhole(false)} className="mt-1 h-4 w-4 accent-[#281870]" />
            <span>Hand over on a date. {current} is paid up to it, {toName} from it.</span></label>
          {!whole && <input type="date" value={from} min={addOne(start)} max={minusOne(end)} onChange={(e) => setFrom(e.target.value)} className="field" required />}
          <label className="flex items-start gap-2 text-body"><input type="radio" checked={whole} onChange={() => setWhole(true)} className="mt-1 h-4 w-4 accent-[#281870]" />
            <span>Move the whole booking from pickup ({nice(start)}): {current} isn&apos;t paid for it.</span></label>
        </fieldset>
      ) : <p className="text-small text-ink-soft">Training hasn&apos;t started, so the whole booking moves: same dates, deal, chat and forms. Both trainers are emailed.</p>}
      <label className="flex items-center gap-2 text-small text-ink-soft"><input type="checkbox" name="force" className="h-4 w-4 accent-[#281870]" />Book anyway, even if they have no free kennel</label>
      <div className="flex gap-2"><Save disabled={!to} /><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div>
      {r && <p role="status" className={`text-small font-semibold ${r.ok ? "text-fern" : "text-heart"}`}>{r.message}</p>}
    </form>
  );
}
const shift = (iso: string, d: number) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const addOne = (iso: string) => shift(iso, 1), minusOne = (iso: string) => shift(iso, -1);
function Save({ disabled }: { disabled: boolean }) { const { pending } = useFormStatus(); return <button className="btn-ink" disabled={pending || disabled}>{pending ? "Changing…" : "Change trainer"}</button>; }
