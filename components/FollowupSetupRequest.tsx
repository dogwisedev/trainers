"use client";
import { useState, useTransition } from "react";
import { requestFollowupSetupAction } from "@/app/followup-actions";

/** Trainer: "Dog not in the list?" (its program isn't in the app). Asks the office to add it for follow-ups. */
export function FollowupSetupRequest() {
  const [open, setOpen] = useState(false), [dog, setDog] = useState(""), [client, setClient] = useState(""), [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (msg?.ok) return <p role="status" className="panel mt-4 p-4 text-small font-semibold text-fern">{msg.text}</p>;
  return (
    <div className="panel mt-4 p-4">
      <p className="font-bold">Dog not in the list?</p>
      <p className="mt-0.5 text-small text-ink-soft">If its program finished before the app, ask the office to add it. Then you can log its sessions and miles here, and they&apos;re paid as usual.</p>
      {!open ? <button type="button" onClick={() => setOpen(true)} className="btn-ghost mt-3 w-full">Ask the office to add a dog</button> : (
        <div className="mt-3 space-y-3">
          <label className="block"><span className="label">Dog&apos;s name</span><input value={dog} onChange={(e) => setDog(e.target.value)} className="field" autoComplete="off" /></label>
          <label className="block"><span className="label">Client&apos;s name</span><input value={client} onChange={(e) => setClient(e.target.value)} className="field" autoComplete="off" /></label>
          <label className="block"><span className="label">Anything else (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. session 1 is on Nov 23" className="field" autoComplete="off" /></label>
          <button type="button" disabled={pending || dog.trim().length < 2 || client.trim().length < 2} onClick={() => start(async () => { const r = await requestFollowupSetupAction(dog, client, note); setMsg({ ok: r.ok, text: r.message }); })} className="btn-ink w-full">{pending ? "Sending…" : "Send to the office"}</button>
          {msg && !msg.ok && <p role="status" className="text-small font-semibold text-heart">{msg.text}</p>}
        </div>
      )}
    </div>
  );
}
