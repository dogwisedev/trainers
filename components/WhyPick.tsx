"use client";
/** One tap on why, offered where a person overrides the app. Buttons, never typing; "Other" needs no explanation. */
export function WhyPick({ reasons, value, onPick, label = "Why?" }: { reasons: string[]; value: string; onPick: (r: string) => void; label?: string }) {
  return (
    <div className="mt-2">
      <p className="mb-1 text-caption font-semibold text-ink-soft">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {reasons.map((r) => <button key={r} type="button" onClick={() => onPick(r)} aria-pressed={value === r} className={`min-h-[36px] rounded-full border px-3 text-small ${value === r ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-soft"}`}>{r}</button>)}
      </div>
    </div>
  );
}
