"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { missReportAction, unwaiveReportAction, waiveReportAction } from "@/app/report-actions";
import type { Kind } from "@/lib/reports";
import { WhyPick } from "@/components/WhyPick";

const WHY = { waive: ["Dog went home early", "Program changed", "Shouldn't exist", "Other"], miss: ["Next form already in", "Too late to be useful", "Trainer did it another way", "Other"] };

/** Admin: "Not needed" takes a form off every to-do list, with no penalty. For a late form, "Missed (late)" does the same but
 *  keeps it on record as late, for the deduction on the trainer's payslip. "Bring it back" undoes either. */
export function WaiveButton({ bookingId, kind, week, reportId, undo, after, className, late }: { bookingId: string; kind: Kind; week: number; reportId?: string | null; undo?: boolean; after?: string; className?: string; late?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [asking, setAsking] = useState<"waive" | "miss" | null>(null);
  const go = (what: "waive" | "miss" | "undo", why = "") => {
    if (what !== "undo" && !why) { setAsking(what); return; } // one tap on why first
    setAsking(null);
    start(async () => {
      const r = what === "undo" ? await unwaiveReportAction(reportId!) : what === "miss" ? await missReportAction(bookingId, kind, week, reportId, why) : await waiveReportAction(bookingId, kind, week, reportId, why);
      setMsg(r.ok ? "" : r.message);
      if (r.ok) { if (after) router.push(after); router.refresh(); }
    });
  };
  const cls = className || "btn-ghost h-9 min-h-0 whitespace-nowrap px-3 text-small";
  return (
    <span className="inline-flex flex-col items-start gap-1"><span className="inline-flex flex-wrap items-center gap-2">
      {undo ? <button type="button" disabled={pending} onClick={() => go("undo")} className={cls}>{pending ? "…" : "Bring it back"}</button> : (
        <>
          {late && <button type="button" disabled={pending} onClick={() => go("miss")} className={cls}>{pending ? "…" : "Missed (late)"}</button>}
          <button type="button" disabled={pending} onClick={() => go("waive")} className={cls}>{pending ? "…" : "Not needed"}</button>
        </>
      )}
      {asking && !pending && <WhyPick reasons={WHY[asking]} value="" onPick={(r) => go(asking, r)} label={asking === "miss" ? "Missed: why?" : "Not needed: why?"} />}
      {msg && <span role="alert" className="text-caption text-heart">{msg}</span>}
    </span></span>
  );
}
