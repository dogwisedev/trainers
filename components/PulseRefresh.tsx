"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { refreshPulseAction } from "@/app/pulse-actions";

/** Throws away the 5-minute cache and loads fresh numbers. */
export function PulseRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn-ghost h-8 min-h-0 px-2.5 text-caption" disabled={pending} onClick={() => start(async () => { await refreshPulseAction(); router.refresh(); })}>
      <RefreshCw size={12} className={pending ? "animate-spin" : ""} />{pending ? "Loading…" : "Refresh"}
    </button>
  );
}
