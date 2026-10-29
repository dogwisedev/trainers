"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { checkRoutesAction } from "@/app/payroll-actions";

/** Works out the routes for this payslip's trips now (otherwise the 20-minute job does a few at a time). */
export function CheckRoutesButton({ payslipId, label }: { payslipId: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" className="btn-ghost h-9 min-h-0 shrink-0 px-3 text-small" disabled={pending}
        onClick={() => start(async () => { setMsg(""); const r = await checkRoutesAction(payslipId); setMsg(r.message); router.refresh(); })}>
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} />{pending ? "Checking…" : label}
      </button>
      {msg && <span role="status" className="mt-1 max-w-[16rem] text-right text-caption text-ink-soft">{msg}</span>}
    </span>
  );
}
