"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { refreshPulseAction } from "@/app/pulse-actions";
import { PulseLoading } from "@/components/PulseLoading";

/** Throws away the snapshot and takes a new one. The loading card covers the page while it happens, as on first load. */
export function PulseRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="btn-ghost h-8 min-h-0 px-2.5 text-caption" disabled={pending} onClick={() => start(async () => { await refreshPulseAction(); router.refresh(); })}>
        <RefreshCw size={12} className={pending ? "animate-spin" : ""} />{pending ? "Taking a new snapshot…" : "Refresh"}
      </button>
      {pending && <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-canvas/90 p-4 pt-16 backdrop-blur-sm md:items-center md:pt-4"><PulseLoading instant /></div>}
    </>
  );
}
