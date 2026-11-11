"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { markRead } from "@/app/actions";

/** To do, on a trainer's message: "No reply needed" marks their thread read (opening the thread does the same). */
export function MarkReadButton({ trainerId }: { trainerId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <button type="button" disabled={pending || done} onClick={() => start(async () => { await markRead(trainerId); setDone(true); router.refresh(); })} className="btn-ghost h-9 min-h-0 px-3 text-small">
      <Check size={15} />{pending ? "Saving…" : "No reply needed"}
    </button>
  );
}
