"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRunDatesAction } from "@/app/payroll-actions";

/** Payslips: the Submitted and Paid dates printed on this pay run's payslips. Folded away: most runs never need it. */
export function PayRunDates({ run, submitted, paid, demo }: { run: string; submitted: string; paid: string; demo: boolean }) {
  const router = useRouter();
  const [s, setS] = useState(submitted), [p, setP] = useState(paid);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const changed = s !== submitted || p !== paid;
  return (
    <details className="panel mb-3 p-3.5 text-body">
      <summary className="cursor-pointer font-semibold text-ink-soft">Dates on these payslips</summary>
      <p className="mt-2 text-small text-ink-soft">What every payslip in this pay run says. The pay period and the amounts don&apos;t change.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block"><span className="label">Submitted</span><input type="date" className="field-sm w-auto" value={s} onChange={(e) => { setS(e.target.value); setMsg(null); }} /></label>
        <label className="block"><span className="label">Paid</span><input type="date" className="field-sm w-auto" value={p} onChange={(e) => { setP(e.target.value); setMsg(null); }} /></label>
        <button type="button" className="btn-ink h-10 min-h-0 px-4" disabled={demo || pending || !changed || !s || !p}
          onClick={() => start(async () => { const r = await setRunDatesAction(run, s, p); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); })}>{pending ? "Saving…" : "Save dates"}</button>
      </div>
      {msg && <p role="status" className={`mt-2 text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </details>
  );
}
