"use client";
import { useState, useTransition } from "react";
import { saveTermsAction } from "@/app/terms-actions";

export function TermsEditor({ text, data }: { text: string; data: string }) {
  const [t, setT] = useState(text), [d, setD] = useState(data);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className="panel space-y-3 p-4 md:p-5">
      <label className="block"><span className="text-lead font-bold">Terms &amp; Conditions</span>
        <span className="mb-2 mt-0.5 block text-small text-ink-soft">Paste the full text from the website. It goes into the copy each client gets when they agree.</span>
        <textarea className="field" rows={14} value={t} onChange={(e) => { setT(e.target.value); setMsg(null); }} /></label>
      <label className="block"><span className="text-lead font-bold">How we use their information and the app</span>
        <span className="mb-2 mt-0.5 block text-small text-ink-soft">Added after the terms. A starting point is filled in: have it checked before relying on it, and remove it if the terms already cover it.</span>
        <textarea className="field" rows={10} value={d} onChange={(e) => { setD(e.target.value); setMsg(null); }} /></label>
      <button type="button" className="btn-ink" disabled={pending || t.trim().length < 50} onClick={() => start(async () => { const r = await saveTermsAction(t, d); setMsg({ ok: r.ok, text: r.message }); })}>{pending ? "Saving…" : "Save as the new version"}</button>
      {msg && <p role="status" className={`text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </section>
  );
}
