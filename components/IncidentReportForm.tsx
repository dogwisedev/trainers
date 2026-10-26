"use client";
import { useState } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { reportIncidentAction } from "@/app/incident-actions";
import { INCIDENT_KINDS } from "@/lib/incidentKinds";

function Send() {
  const { pending } = useFormStatus();
  return <button className="btn-danger w-full" disabled={pending}>{pending ? "Sending…" : "Send to the Dogwise team"}</button>;
}
const YesNo = ({ name, label, onChange }: { name: string; label: string; onChange?: (v: string) => void }) => (
  <fieldset><legend className="label">{label}</legend>
    <div className="flex gap-2">{["yes", "no"].map((v) => <label key={v} className="flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-1.5 text-body has-[:checked]:border-ink has-[:checked]:bg-mint"><input type="radio" name={name} value={v} required onChange={() => onChange?.(v)} />{v === "yes" ? "Yes" : "No"}</label>)}</div>
  </fieldset>
);

/** Trainer: report an incident (injury, escape, bite…) from the dog's chat. */
export function IncidentReportForm({ chatId, dogs, now, back }: { chatId: string; dogs: { id: string; name: string }[]; now: string; back: string }) {
  const [r, act] = useFormState(reportIncidentAction, null);
  const [vet, setVet] = useState("");
  if (r?.ok) return <div className="panel space-y-3 p-5"><p className="font-bold text-fern">{r.message}</p><Link prefetch={false} href={back} className="btn-ink">Back to the chat</Link></div>;
  return (
    <form action={act} className="panel space-y-4 p-5">
      <input type="hidden" name="chat_id" value={chatId} />
      {dogs.length > 1 ? (
        <label className="block"><span className="label">Which dog?</span><select name="booking_id" className="field" required defaultValue=""><option value="" disabled>Choose…</option>{dogs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      ) : <input type="hidden" name="booking_id" value={dogs[0]?.id || ""} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">What happened?</span><select name="kind" className="field" required defaultValue=""><option value="" disabled>Choose…</option>{INCIDENT_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <label className="block"><span className="label">When?</span><input type="datetime-local" name="occurred_at" defaultValue={now} max={now} className="field" required /></label>
      </div>
      <label className="block"><span className="label">Describe what happened</span><textarea name="what" rows={4} className="field" required placeholder="Where you were, what led to it, who and what was involved, any injuries." /></label>
      <label className="block"><span className="label">What did you do?</span><textarea name="action" rows={3} className="field" required placeholder="First aid, where the dog is now, anything still to do." /></label>
      <YesNo name="vet" label="Did the dog see a vet (or need to)?" onChange={setVet} />
      {vet === "yes" && <label className="block"><span className="label">Vet details</span><input name="vet_details" className="field" required placeholder="Clinic, what they said, cost if known" /></label>}
      <YesNo name="client_told" label="Has the client been told?" />
      <p className="rounded-xl bg-paper p-3 text-small text-ink-soft">Post any photos or videos in the dog&apos;s chat. If it&apos;s an emergency, call the office as well.</p>
      <Send />
      {r && !r.ok && <p role="alert" className="rounded-xl bg-heart-wash px-3 py-2 text-body text-heart">{r.message}</p>}
    </form>
  );
}
