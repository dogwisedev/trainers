"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { missReportAction, unwaiveReportAction, waiveReportAction } from "@/app/report-actions";
import type { Kind } from "@/lib/reports";

/** Admin: "Not needed" takes a form off every to-do list, with no penalty. For a late form, "Missed (late)" does the same but
 *  keeps it on record as late, for the deduction on the trainer's payslip. "Bring it back" undoes either. */
export function WaiveButton({ bookingId, kind, week, reportId, undo, after, className, late }: { bookingId: string; kind: Kind; week: number; reportId?: string | null; undo?: boolean; after?: string; className?: string; late?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const go = (what: "waive" | "miss" | "undo") => {
    if (what === "waive" && !window.confirm("Mark this form as not needed? It disappears from the trainer's list and won't count as late (no penalty). You can bring it back.")) return;
    if (what === "miss" && !window.confirm("Mark this form as missed? It's late and not needed any more: it disappears from the trainer's list, but stays on record as late and is listed on their payslip for the deduction. You can bring it back.")) return;
    start(async () => {
      const r = what === "undo" ? await unwaiveReportAction(reportId!) : what === "miss" ? await missReportAction(bookingId, kind, week, reportId) : await waiveReportAction(bookingId, kind, week, reportId);
      setMsg(r.ok ? "" : r.message);
      if (r.ok) { if (after) router.push(after); router.refresh(); }
    });
  };
  const cls = className || "btn-ghost h-9 min-h-0 whitespace-nowrap px-3 text-small";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {undo ? <button type="button" disabled={pending} onClick={() => go("undo")} className={cls}>{pending ? "…" : "Bring it back"}</button> : (
        <>
          {late && <button type="button" disabled={pending} onClick={() => go("miss")} className={cls}>{pending ? "…" : "Missed (late)"}</button>}
          <button type="button" disabled={pending} onClick={() => go("waive")} className={cls}>{pending ? "…" : "Not needed"}</button>
        </>
      )}
      {msg && <span role="alert" className="text-caption text-heart">{msg}</span>}
    </span>
  );
}
