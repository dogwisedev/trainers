"use client";
import { useFormState, useFormStatus } from "react-dom";
import { logFollowupAction } from "@/app/actions";

function Save() {
  const { pending } = useFormStatus();
  return <button className="btn-ink w-full" disabled={pending}>{pending ? "Saving…" : "Save session"}</button>;
}

/** Trainer: log a follow-up session (date, dog, miles driven, what was done). */
export function FollowupForm({ dogs, dog, today }: { dogs: { id: string; label: string }[]; dog?: string; today: string }) {
  const [r, act] = useFormState(logFollowupAction, null);
  if (r?.ok) return <div className="panel p-5"><p className="font-bold text-fern">{r.message}</p><a href="/t/followup" className="btn-ghost mt-3">Log another</a></div>;
  return (
    <form action={act} className="panel space-y-4 p-5">
      <label className="block"><span className="label">Dog</span>
        <select name="booking_id" defaultValue={dog || ""} className="field" required>
          <option value="" disabled>Choose…</option>
          {dogs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="label">Date of the session</span><input type="date" name="date" defaultValue={today} max={today} className="field" required /></label>
        <label className="block"><span className="label">Miles driven</span><input name="miles" inputMode="decimal" className="field" placeholder="e.g. 40" required /><span className="mt-1 block text-[12px] text-ink-faint">Round trip. 0 if none.</span></label>
      </div>
      <label className="block"><span className="label">What did you work on?</span><textarea name="notes" rows={4} className="field" required placeholder="What you practised with the dog and owner, how it went, and any homework you gave." /></label>
      <Save />
      {r && !r.ok && <p role="alert" className="rounded-xl bg-heart-wash px-3 py-2 text-[14px] text-heart">{r.message}</p>}
    </form>
  );
}
