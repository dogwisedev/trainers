"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveChecklistAction, setAiSettingAction } from "@/app/ai-actions";
import type { CheckMode } from "@/lib/aiSettings";
import type { Kind } from "@/lib/reports";

const MODES: { v: CheckMode; label: string }[] = [{ v: "off", label: "Off" }, { v: "suggest", label: "Suggest" }, { v: "auto", label: "Approve clean ones" }];

/** Off · Suggest · Approve clean ones itself (weekly checks and intake forms with nothing to look at; never handover reports). */
export function CheckModeSwitch({ mode }: { mode: CheckMode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const set = (v: CheckMode) => {
    if (v === "auto" && !window.confirm("Let the app approve weekly health checks and intake forms itself when they fit the standard and have nothing to look at? Anything flagged, any health \"yes\", and every handover report still comes to you.")) return;
    start(async () => { const r = await setAiSettingAction("formCheck", v); setErr(r.ok ? "" : r.message); router.refresh(); });
  };
  return (
    <div>
      <div role="radiogroup" aria-label="Form checks" className="inline-flex rounded-full border border-line bg-white p-1">
        {MODES.map((m) => <button key={m.v} type="button" role="radio" aria-checked={mode === m.v} disabled={pending} onClick={() => set(m.v)} className={`min-h-[40px] rounded-full px-3.5 text-small font-semibold ${mode === m.v ? "bg-ink text-white" : "text-ink-soft"}`}>{m.label}</button>)}
      </div>
      {err && <p role="alert" className="mt-1 text-small text-heart">{err}</p>}
    </div>
  );
}

export function OnOff({ name, on, label }: { name: "handoverDrafts" | "captions" | "voice" | "vaccineChecks"; on: boolean; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={pending} onClick={() => start(async () => { const r = await setAiSettingAction(name, !on); setErr(r.ok ? "" : r.message); router.refresh(); })}
        className={`inline-flex min-h-[40px] items-center rounded-full border px-4 text-small font-semibold ${on ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-soft"}`}>{pending ? "…" : on ? "On" : "Off"}</button>
      {err && <p role="alert" className="mt-1 text-small text-heart">{err}</p>}
    </div>
  );
}

/** One form's checklist: what the app checks a submitted form against. Any admin can change it; empty = the built-in one. */
export function ChecklistEditor({ kind, title, text, builtIn }: { kind: Kind | "vaccines"; title: string; text: string; builtIn: string }) {
  const [value, setValue] = useState(text);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = (t: string) => start(async () => { const r = await saveChecklistAction(kind, t); setMsg({ ok: r.ok, text: r.message }); });
  return (
    <section className="panel p-4 md:p-5">
      <label className="block"><span className="text-lead font-bold">{title}</span>
        <span className="mb-2 mt-0.5 block text-small text-ink-soft">One point per line, in plain words: what a good one has, and what you&apos;d send back.</span>
        <textarea className="field" rows={9} value={value} onChange={(e) => { setValue(e.target.value); setMsg(null); }} /></label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-ink" disabled={pending || !value.trim()} onClick={() => save(value)}>{pending ? "Saving…" : "Save checklist"}</button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => { setValue(builtIn); save(""); }}>Use the built-in one</button>
      </div>
      {msg && <p role="status" className={`mt-2 text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </section>
  );
}
