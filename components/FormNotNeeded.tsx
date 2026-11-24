"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { missReportAction, waiveReportAction } from "@/app/report-actions";
import type { Kind } from "@/lib/reports";

/** On a late form in To do: it isn't coming, and that's settled. "Not needed" (no pay change) or "Missed" (counts as late). */
export function FormNotNeeded({ bookingId, kind, week }: { bookingId: string; kind: Kind; week: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const go = (fn: typeof waiveReportAction, why: string) => start(async () => {
    try { const r = await fn(bookingId, kind, week, null, why); setMsg(r.ok ? "" : r.message); } catch { /* done on the server: the refresh shows it */ }
    setOpen(false); router.refresh();
  });
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" disabled={pending} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="btn-ghost h-10 min-h-0 px-3.5 text-small"><Check size={15} />{pending ? "Saving…" : "Done"}</button>
      {open && !pending && (
        <span className="mt-2 block max-w-md rounded-2xl border border-line bg-paper/70 p-3">
          <span className="mb-1.5 block text-caption font-semibold text-ink-soft">This form isn&apos;t coming. Which is it?</span>
          <span className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => go(waiveReportAction, "Not needed (from To do)")} className="min-h-[38px] rounded-full border border-line bg-white px-3 text-small text-ink-soft">Not needed (no pay change)</button>
            <button type="button" onClick={() => go(missReportAction, "Too late (from To do)")} className="min-h-[38px] rounded-full border border-line bg-white px-3 text-small text-ink-soft">Missed: too late now (counts as late)</button>
          </span>
        </span>
      )}
      {msg && <span className="mt-1 text-caption text-heart">{msg}</span>}
    </span>
  );
}
