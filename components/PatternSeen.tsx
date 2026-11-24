"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { patternSeenAction } from "@/app/nudge-actions";
import { WhyPick } from "@/components/WhyPick";

const WHY = ["Called the client", "Spoke to the trainer", "Already being handled", "Nothing to it", "Other"];
export function PatternSeen({ chatId }: { chatId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" disabled={pending} onClick={() => setOpen((o) => !o)} className="btn-ghost h-9 min-h-0 px-3 text-small"><Check size={15} />{pending ? "…" : "Looked into it"}</button>
      {open && !pending && <WhyPick reasons={WHY} value="" onPick={(r) => start(async () => { try { await patternSeenAction(chatId, r); } catch { /* the refresh shows it */ } router.refresh(); })} label="What happened?" />}
    </span>
  );
}
