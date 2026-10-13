"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { unwaiveReportAction, waiveReportAction } from "@/app/report-actions";
import type { Kind } from "@/lib/reports";

/** Admin: "Not needed" takes a form off every to-do list (admin and trainer). "Bring it back" undoes it. */
export function WaiveButton({ bookingId, kind, week, reportId, undo, after, className }: { bookingId: string; kind: Kind; week: number; reportId?: string | null; undo?: boolean; after?: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const click = () => {
    if (!undo && !window.confirm("Mark this form as not needed? It disappears from the trainer's list and won't count as late. You can bring it back.")) return;
    start(async () => {
      const r = undo ? await unwaiveReportAction(reportId!) : await waiveReportAction(bookingId, kind, week, reportId);
      setMsg(r.ok ? "" : r.message);
      if (r.ok) { if (after) router.push(after); router.refresh(); }
    });
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} onClick={click} className={className || "btn-ghost h-9 min-h-0 whitespace-nowrap px-3 text-[13px]"}>{pending ? "…" : undo ? "Bring it back" : "Not needed"}</button>
      {msg && <span role="alert" className="text-[12px] text-heart">{msg}</span>}
    </span>
  );
}
