"use client";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { logFollowupAction } from "@/app/actions";

function Save() {
  const { pending } = useFormStatus();
  return <button className="btn-ink w-full" disabled={pending}>{pending ? "Saving…" : "Save session"}</button>;
}

/** Trainer: log a follow-up session (date, dog, did it happen, how long, miles driven, what was done). Fills the session's FUP fields in HubSpot. */
export function FollowupForm({ dogs, dog, today }: { dogs: { id: string; label: string }[]; dog?: string; today: string }) {
  const [r, act] = useFormState(logFollowupAction, null);
  const [happened, setHappened] = useState(true);
  if (r?.ok) return <div className="panel p-5"><p className="font-bold text-fern">{r.message}</p><a href="/t/followup" className="btn-ghost mt-3">Log another</a></div>;
  return (
    <form action={act} className="panel space-y-4 p-5">
      <label className="block"><span className="label">Dog</span>
        <select name="booking_id" defaultValue={dog || ""} className="field" required>
          <option value="" disabled>Choose…</option>
          {dogs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </label>
      <fieldset>
        <legend className="label">Did the session happen?</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <label className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-body ${happened ? "border-ink bg-mint-wash font-semibold" : "border-line"}`}><input type="radio" name="happened" value="yes" checked={happened} onChange={() => setHappened(true)} />Yes</label>
          <label className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-body ${!happened ? "border-ink bg-heart-wash font-semibold" : "border-line"}`}><input type="radio" name="happened" value="no" checked={!happened} onChange={() => setHappened(false)} />No, it didn&apos;t</label>
        </div>
      </fieldset>
      {happened && <label className="block"><span className="label">How long was it? (minutes)</span><input name="minutes" inputMode="numeric" className="field" placeholder="e.g. 60" required /></label>}
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="label">Date of the session</span><input type="date" name="date" defaultValue={today} max={today} className="field" required /></label>
        <label className="block"><span className="label">Miles driven</span><input name="miles" inputMode="decimal" className="field" placeholder="e.g. 40" required /><span className="mt-1 block text-caption text-ink-faint">Round trip. 0 if none.</span></label>
      </div>
      <label className="block"><span className="label">{happened ? "What did you work on?" : "What happened?"}</span><textarea name="notes" rows={4} className="field" required placeholder={happened ? "What you practiced with the dog and owner, how it went, and any homework you gave." : "e.g. Client didn't show, or asked to move it."} /></label>
      <Save />
      {r && !r.ok && <p role="alert" className="rounded-xl bg-heart-wash px-3 py-2 text-body text-heart">{r.message}</p>}
    </form>
  );
}
