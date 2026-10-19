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
      <p className="text-[13px] text-ink-soft">The amount agreed with Sean for each whole program, e.g. $2,000 for 4 weeks. It's paid by the day (amount ÷ program days) for the days trained in each pay period. Extra days use the same day rate; 7 and 8 week programs use the 6-week day rate. Only admins can see these.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {RATE_FIELDS.map(([k, label]) => {
          const n = Number(vals[k as string]);
          return (
            <label key={k} className="block">
              <span className="label">{label} program</span>
              <span className="relative block">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint">$</span>
                <input name={k} inputMode="decimal" value={vals[k as string]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} className="field pl-7" placeholder="Not set" />
              </span>
              <span className="mt-1 block text-[12px] text-ink-faint">{vals[k as string] && n > 0 ? `${money(n / WEEKS[k as string])} a week, ${money(n / (WEEKS[k as string] * 7))} a day` : "\u00a0"}</span>
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
      <fieldset className="rounded-xl border border-line p-3.5">
        <legend className="px-1 text-[14px] font-bold">Mileage</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Pay per mile</span>
            <span className="relative block"><span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint">$</span>
              <input name="mileage_rate" inputMode="decimal" defaultValue={rates.mileage_rate ?? ""} className="field pl-7" placeholder="No mileage pay" /></span>
          </label>
          <label className="block">
            <span className="label">Paid over (miles per trip)</span>
            <input name="mileage_free_miles" inputMode="decimal" defaultValue={rates.mileage_free_miles ?? 0} className="field" />
          </label>
        </div>
        <p className="mt-2 text-[12px] text-ink-faint">Each pickup, drop-off and follow-up session: (miles − paid-over miles) × pay per mile. e.g. 40 miles, paid over 20, at $0.30 = $6.00. Added to the payslip for the pay period the trip falls in.</p>
      </fieldset>
      <label className="block max-w-[220px]">
        <span className="label">Follow-up session pay</span>
        <span className="relative block"><span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint">$</span>
          <input name="followup_rate" inputMode="decimal" defaultValue={rates.followup_rate ?? 60} className="field pl-7" /></span>
        <span className="mt-1 block text-[12px] text-ink-faint">Per session, paid in the pay period of the session date.</span>
      </label>
      <Save />
      {r && <p role="status" className={`rounded-xl px-3 py-2 text-[14px] ${r.ok ? "bg-mint-wash text-fern" : "bg-heart-wash text-heart"}`}>{r.message}</p>}
    </form>
  );
}
