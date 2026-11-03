"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { FILTER_KEYS, PRESETS, type DogFilter, activeCount, describe, windows } from "@/lib/dogFilters";

// Dogs → Filters. One-tap views (the office's HubSpot reports), then any mix of conditions; all of them must match.
// Everything lives in the URL: bookmark it, share it, and Export CSV gives exactly this list.
type Props = { tab: string; keep: Record<string, string>; f: DogFilter; states: string[]; programs: string[]; today: string; total: number };

const Choice = <T extends string>({ label, value, options, onChange }: { label: string; value?: T; options: [T | "", string][]; onChange: (v: T | undefined) => void }) => (
  <div>
    <p className="label">{label}</p>
    <div className="mt-1 flex flex-wrap gap-1.5">{options.map(([v, l]) => <button key={v || "any"} type="button" onClick={() => onChange((v || undefined) as T | undefined)} className={`chip ${(value || "") === v ? "chip-on" : ""}`}>{l}</button>)}</div>
  </div>
);

function DateRange({ label, from, to, today, onChange }: { label: string; from?: string; to?: string; today: string; onChange: (a?: string, b?: string) => void }) {
  const w = windows(today);
  const quick: [string, string, string][] = [["Today", ...w.today], ["This weekend", ...w.weekend], ["This week", ...w.week], ["Next week", ...w.nextweek], ["This month", ...w.month]];
  return (
    <div>
      <p className="label">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onChange(undefined, undefined)} className={`chip ${!from && !to ? "chip-on" : ""}`}>Any</button>
        {quick.map(([l, a, b]) => <button key={l} type="button" onClick={() => onChange(a, b)} className={`chip ${from === a && to === b ? "chip-on" : ""}`}>{l}</button>)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block"><span className="text-caption text-ink-soft">From (or on)</span><input type="date" value={from || ""} onChange={(e) => onChange(e.target.value || undefined, to && e.target.value && to < e.target.value ? e.target.value : to || e.target.value || undefined)} className="field h-11" /></label>
        <label className="block"><span className="text-caption text-ink-soft">To</span><input type="date" value={to || ""} min={from} onChange={(e) => onChange(from, e.target.value || undefined)} className="field h-11" /></label>
      </div>
    </div>
  );
}

export function DogFilters({ tab, keep, f: initial, states, programs, today, total }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<DogFilter>(initial);
  const go = (nf: DogFilter, nextTab = tab) => {
    const p = new URLSearchParams({ ...keep, f: nextTab });
    for (const k of FILTER_KEYS) { const v = nf[k]; if (v) p.set(k, String(v)); }
    setOpen(false); router.push(`/a/dogs?${p}`);
  };
  const set = (patch: Partial<DogFilter>) => setF((cur) => ({ ...cur, ...patch }));
  const chips = describe(initial), n = activeCount(initial), w = windows(today);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => { setF(initial); setOpen(true); }} className={`chip ${n ? "border-ink bg-ink text-white" : ""}`}><SlidersHorizontal size={14} />Filters{n ? ` · ${n}` : ""}</button>
        {chips.map((c) => (
          <button key={c.key} type="button" onClick={() => { const nf = { ...initial }; for (const k of c.drop) delete nf[k as keyof DogFilter]; go(nf); }} className="chip border-ink/30 bg-mint-wash" aria-label={`Remove ${c.text}`}>
            {c.text}<X size={13} />
          </button>
        ))}
        {n > 0 && <><button type="button" onClick={() => go({})} className="px-1 text-small font-semibold text-ink-soft underline">Clear all</button><span className="ml-auto text-small text-ink-soft">{total} match</span></>}
      </div>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/40 md:items-center md:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="df-title" className="flex max-h-[90vh] w-full flex-col rounded-t-[22px] bg-white shadow-card md:max-w-xl md:rounded-[22px]">
            <div className="flex items-center justify-between gap-2 px-4 pt-4">
              <h2 id="df-title" className="text-lead font-extrabold">Filter dogs</h2>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => go(f)} className="btn-ink h-10 min-h-0 px-4">Show</button>
                <button type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-paper" aria-label="Close"><X size={18} /></button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4 pt-3">
              <div>
                <p className="label">Quick views</p>
                <div className="mt-1 flex flex-wrap gap-1.5">{PRESETS.map((p) => <button key={p.key} type="button" onClick={() => go(p.f(w), p.tab)} className="chip">{p.label}</button>)}</div>
                <p className="mt-1 text-caption text-ink-faint">The office&apos;s HubSpot reports, in one tap. &ldquo;This weekend&rdquo; is Thursday to Wednesday.</p>
              </div>
              <DateRange label="Starts" from={f.sf} to={f.st} today={today} onChange={(a, b) => set({ sf: a, st: b })} />
              <DateRange label="Ends (handover)" from={f.ef} to={f.et} today={today} onChange={(a, b) => set({ ef: a, et: b })} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Choice label="Vaccines" value={f.vac} options={[["", "Any"], ["missing", "Missing"], ["ok", "OK"]]} onChange={(v) => set({ vac: v })} />
                <Choice label="Before-training forms" value={f.forms} options={[["", "Any"], ["missing", "Missing"], ["done", "Done"]]} onChange={(v) => set({ forms: v })} />
                <Choice label="Balance" value={f.bal} options={[["", "Any"], ["owed", "Owed"], ["paid", "Paid"]]} onChange={(v) => set({ bal: v })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Choice label="Pickup" value={f.pu} options={[["", "Any"], ["late", "Not confirmed"]]} onChange={(v) => set({ pu: v })} />
                <Choice label="Weekly reports" value={f.rep} options={[["", "Any"], ["late", "Late or missing"]]} onChange={(v) => set({ rep: v })} />
                <Choice label="Handover report" value={f.ho} options={[["", "Any"], ["missing", "Missing"], ["in", "In"]]} onChange={(v) => set({ ho: v })} />
              </div>
              <Choice label="Follow-ups" value={f.fu} options={[["", "Any"], ["none", "None booked"], ["asked", "Asked for"], ["booked", "Booked"], ["done", "Done"]]} onChange={(v) => set({ fu: v })} />
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="label">Client&apos;s state</span>
                  <select value={f.state || ""} onChange={(e) => set({ state: e.target.value || undefined })} className="field h-11"><option value="">Any</option>{states.map((s) => <option key={s}>{s}</option>)}</select></label>
                <label className="block"><span className="label">Program</span>
                  <select value={f.prog || ""} onChange={(e) => set({ prog: e.target.value || undefined })} className="field h-11"><option value="">Any</option>{programs.map((s) => <option key={s}>{s}</option>)}</select></label>
              </div>
              <p className="text-caption text-ink-faint">Every condition you pick must match. Trainer, POC and search still apply.</p>
            </div>
            <div className="flex shrink-0 gap-2 border-t border-line px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
              <button type="button" onClick={() => go(f)} className="btn-ink flex-1">Show dogs</button>
              <button type="button" onClick={() => setF({})} className="btn-ghost">Reset</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
