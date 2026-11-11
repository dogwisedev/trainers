"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setDeductedAction } from "@/app/report-actions";

export type MissedForm = { id: string; dog: string; client: string; name: string; due: string; by: string | null; deducted: boolean };

/** On a trainer's payslip: forms marked "Missed (late)" (still to deduct first). Add the deduction line on the payslip
 *  as usual, then tick Deducted so it leaves the list. */
export function MissedForms({ forms }: { forms: MissedForm[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const open = forms.filter((f) => !f.deducted).length;
  return (
    <div className="panel mb-4 p-4">
      <p className="font-bold">{open ? `${open} missed form${open > 1 ? "s" : ""} to deduct` : "Missed forms: all deducted"}</p>
      <p className="mt-0.5 text-small text-ink-soft">Late and marked missed, so the trainer doesn&apos;t have to send them any more. Add the deduction below (Deduction: missing weekly reports), then tick Deducted.</p>
      <ul className="mt-2 divide-y divide-line">
        {forms.map((f) => (
          <li key={f.id} className="flex min-h-[48px] flex-wrap items-center gap-3 py-2">
            <span className="min-w-0 flex-1 text-body"><Link prefetch={false} href={`/a/reports/${f.id}`} className="font-semibold hover:underline">{f.dog}: {f.name}</Link><span className="block text-small text-ink-soft">{f.client} · due {f.due}{f.by ? ` · marked by ${f.by}` : ""}</span></span>
            <label className="flex min-h-[44px] items-center gap-2 text-small font-semibold">
              <input type="checkbox" checked={f.deducted} disabled={pending} onChange={(e) => start(async () => { await setDeductedAction(f.id, e.target.checked); router.refresh(); })} className="h-5 w-5 accent-[#281870]" />Deducted
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
