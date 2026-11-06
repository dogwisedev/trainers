"use client";
import { useFormState, useFormStatus } from "react-dom";
import { saveQuoNumberAction } from "@/app/nudge-actions";

function Save() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="btn-ghost w-full">{pending ? "Saving…" : "Save Quo number"}</button>;
}

/** Your account: the Quo number texts to your trainers come from, and the Point of Contact name you answer to. */
export function QuoNumberForm({ number, poc, options }: { number: string; poc: string; options: { poc: string; n: number }[] }) {
  const [r, act] = useFormState(saveQuoNumberAction, null);
  return (
    <form action={act} className="space-y-3">
      <label className="block">
        <span className="label">Your Quo number</span>
        <input name="number" defaultValue={number} inputMode="tel" autoComplete="off" placeholder="+1 646 576 7764" className="field" />
      </label>
      <label className="block">
        <span className="label">Trainers who have you as Point of Contact</span>
        <select name="poc" defaultValue={poc} className="field">
          {options.map((o) => <option key={o.poc} value={o.poc}>{o.poc}: {o.n} trainer{o.n === 1 ? "" : "s"}</option>)}
          <option value="">I&apos;m not anyone&apos;s Point of Contact</option>
        </select>
      </label>
      <Save />
      {r && <p role="status" className={`text-small font-semibold ${r.ok ? "text-fern" : "text-heart"}`}>{r.message}</p>}
    </form>
  );
}
