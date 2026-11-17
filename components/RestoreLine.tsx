"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { restoreLineAction } from "@/app/payroll-actions";

/** Brings back an automatic payslip line that was deleted earlier (it comes back at the next refresh, which the page does on open). */
export function RestoreLine({ payslipId, lineKey }: { payslipId: string; lineKey: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <button type="button" disabled={pending} onClick={() => start(async () => { await restoreLineAction(payslipId, lineKey); router.refresh(); })} className="ml-2 font-semibold underline">{pending ? "…" : "Bring it back"}</button>;
}
