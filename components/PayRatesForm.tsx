"use client";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { saveRatesAction } from "@/app/payroll-actions";
import { RATE_FIELDS, Rates, money } from "@/lib/payroll";

const WEEKS: Record<string, number> = { w2: 2, w3: 3, w4: 4, w4_rehab: 4, w5_rehab: 5, w6_rehab: 6 };

function Save() {
  const { pending } = useFormStatus();
  return <button className="btn-ink w-full" disabled={pending}>{pending ? "Saving…" : "Save pay rates"}</button>;
}

export function PayRatesForm({ trainerId, rates }: { trainerId: string; rates: Rates }) {
  const [r, act] = useFormState(saveRatesAction, null);
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(RATE_FIELDS.map(([k]) => [k, rates[k] == null ? "" : String(rates[k])])));
  return (
    <form action={act} className="space-y-4">
      <input type="hidden" name="trainer_id" value={trainerId} />
      <p className="text-[13px] text-ink-soft">The weekly rate agreed with Sean for each program type. 7 and 8 week programs use the 6-week rate, and extra days are paid at the weekly rate ÷ 7. Only admins can see these.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {RATE_FIELDS.map(([k, label]) => {
          const n = Number(vals[k as string]);
          return (
            <label key={k} className="block">
              <span className="label">{label}, per week</span>
              <span className="relative block">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint">$</span>
                <input name={k} inputMode="decimal" value={vals[k as string]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} className="field pl-7" placeholder="Not set" />
              </span>
              <span className="mt-1 block text-[12px] text-ink-faint">{vals[k as string] && n > 0 ? `${money(n * WEEKS[k as string])} for the program, ${money(n / 7)} a day` : "\u00a0"}</span>
            </label>
          );
        })}
      </div>
      <label className="block max-w-[220px]">
        <span className="label">Full report deduction</span>
        <span className="relative block"><span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint">$</span>
          <input name="report_deduction" inputMode="decimal" defaultValue={rates.report_deduction ?? 100} className="field pl-7" /></span>
        <span className="mt-1 block text-[12px] text-ink-faint">Missed weekly report or late handover, at 100%.</span>
      </label>
      <Save />
      {r && <p role="status" className={`rounded-xl px-3 py-2 text-[14px] ${r.ok ? "bg-mint-wash text-fern" : "bg-heart-wash text-heart"}`}>{r.message}</p>}
    </form>
  );
}
