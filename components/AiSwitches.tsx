"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveChecklistAction, setAiSettingAction } from "@/app/ai-actions";
import type { CheckMode } from "@/lib/aiSettings";
import type { Kind } from "@/lib/reports";

// Form checks on or off. Approving on their own is the separate Auto switch (earned, with spot checks).
const MODES: { v: CheckMode; label: string }[] = [{ v: "off", label: "Off" }, { v: "suggest", label: "On" }];

/** Off · Suggest · Approve clean ones itself (weekly checks and intake forms with nothing to look at; never handover reports). */
export function CheckModeSwitch({ mode }: { mode: CheckMode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const set = (v: CheckMode) => {
    if (v === "suggest" && mode === "auto") return; // already on (and approving on its own)
    start(async () => { const r = await setAiSettingAction("formCheck", v); setErr(r.ok ? "" : r.message); router.refresh(); });
  };
  return (
    <div>
      <div role="radiogroup" aria-label="Form checks" className="inline-flex rounded-full border border-line bg-white p-1">
        {MODES.map((m) => <button key={m.v} type="button" role="radio" aria-checked={m.v === "off" ? mode === "off" : mode !== "off"} disabled={pending} onClick={() => set(m.v)} className={`min-h-[40px] rounded-full px-3.5 text-small font-semibold ${(m.v === "off" ? mode === "off" : mode !== "off") ? "bg-ink text-white" : "text-ink-soft"}`}>{m.label}</button>)}
      </div>
      {err && <p role="alert" className="mt-1 text-small text-heart">{err}</p>}
    </div>
  );
}

export function OnOff({ name, on, label }: { name: "handoverDrafts" | "captions" | "voice" | "vaccineChecks" | "vaccineAuto"; on: boolean; label: string }) {
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

/** "Auto" for a feature that can decide on its own (vaccines, forms). Can only be switched on once it has earned it (the
 *  server checks too): the reason shows instead. While on, 1 in 10 still goes to a person, and it switches itself off if
 *  people disagree too often. */
export function AutoSwitch({ feature, on, canAuto, need }: { feature: "vaccines" | "forms"; on: boolean; canAuto: boolean; need: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const flip = () => {
    if (!on && !window.confirm(feature === "vaccines" ? "Let the AI approve vaccine records that are all in order, on its own? Anything missing or unclear still comes to a person, and 1 in 10 of the rest too, as a spot check." : "Let the AI approve weekly checks and intake forms that fit the standard, on its own? Anything it flags, any health \"yes\" and every handover report still comes to a person, and 1 in 10 of the rest too, as a spot check.")) return;
    start(async () => { const r = feature === "vaccines" ? await setAiSettingAction("vaccineAuto", !on) : await setAiSettingAction("formCheck", on ? "suggest" : "auto"); setErr(r.ok ? "" : r.message); router.refresh(); });
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" role="switch" aria-checked={on} disabled={pending || (!on && !canAuto)} onClick={flip}
        className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-4 text-small font-semibold ${on ? "border-fern bg-fern text-white" : canAuto ? "border-ink bg-white text-ink" : "border-line bg-paper text-ink-faint"}`}>
        {pending ? "…" : on ? "Auto: on" : "Auto: off"}
      </button>
      {!on && !canAuto && need && <span className="text-caption text-ink-faint">Can switch on after: {need}</span>}
      {err && <span role="alert" className="text-caption text-heart">{err}</span>}
    </div>
  );
}

/** "AI approval 98% · 4 weeks · 52 decisions" */
export function RatePill({ rate, decided, what, weeks }: { rate: number | null; decided: number; what: string; weeks: number }) {
  const tone = rate === null ? "bg-paper text-ink-soft" : rate >= 95 ? "bg-mint-wash text-fern" : rate >= 80 ? "bg-biscuit-wash text-warn" : "bg-heart-wash text-heart";
  return <span className={`inline-flex min-h-[28px] items-center rounded-full px-3 text-small font-semibold tabular-nums ${tone}`}>{rate === null ? `AI approval: not enough yet` : `AI approval ${rate}%`} · {weeks} weeks · {decided} {what}</span>;
}
