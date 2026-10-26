"use client";
import { useState, useTransition } from "react";
import { setReportsEnabledAction } from "@/app/report-actions";

/** Turns weekly/handover reports on or off for one booking (old bookings start off so nobody gets a pile of overdue reports). */
export function ReportsToggle({ id, on }: { id: string; on: boolean }) {
  const [value, setValue] = useState(on);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <button type="button" disabled={pending} aria-pressed={value} title={msg || "Weekly and handover reports for this booking"}
      className={`h-9 rounded-lg border px-2.5 text-small font-semibold ${value ? "border-fern/40 bg-mint-wash text-fern" : "border-line bg-white text-ink-soft"}`}
      onClick={() => start(async () => { const r = await setReportsEnabledAction(id, !value); if (r.ok) { setValue(!value); setMsg(""); } else setMsg(r.message); })}>
      {pending ? "…" : value ? "Reports on" : "Reports off"}
    </button>
  );
}
