"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { PulseLoading } from "@/components/PulseLoading";

export const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Month chips on Sales. A month that hasn't loaded yet takes a few seconds (then it's kept for an hour), so the loading card shows while it does. */
export function MonthNav({ months, month, base, onlyOwed }: { months: string[]; month: string; base: string; onlyOwed: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (m: string) => { if (m === month) return; start(() => router.push(`${base}?m=${m}${onlyOwed ? "&owed=1" : ""}`)); };
  return (
    <>
      <nav className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Month">
        {months.map((m) => <button key={m} type="button" onClick={() => go(m)} disabled={pending} aria-current={m === month ? "page" : undefined} className={`chip shrink-0 ${m === month ? "chip-on" : ""}`}>{monthLabel(m)}</button>)}
      </nav>
      {pending && <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-canvas/90 p-4 pt-16 backdrop-blur-sm md:items-center md:pt-4"><PulseLoading instant steps={["That month's sales", "The same month last year", "Last month", "Leads and calls", "Working it out"]} lines={["One moment.", "Asking HubSpot nicely.", "Comparing with last year.", "Nearly there."]} note="Once a month has loaded, it's kept for an hour, so coming back is instant." /></div>}
    </>
  );
}
