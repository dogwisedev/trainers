"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { resolveIncidentAction } from "@/app/chat-actions";
import { WhyPick } from "@/components/WhyPick";

const WHY = ["Done in HubSpot", "Done by phone", "Done by email or text", "Not needed", "Other"];
/** "Done" on a To do item: one tap on why (so we learn what still happens by hand), then it closes. */
export function TodoDone({ id, label = "Done" }: { id: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  // The answer can get cut off on its way back (seen as "Error in input stream") after the server has done the work:
  // refresh either way, so the row shows what's true.
  const close = (why: string) => start(async () => {
    try { const r = await resolveIncidentAction(id, why); if (!r.ok) setErr(r.message); } catch { /* done on the server: the refresh shows it */ }
    setOpen(false); router.refresh();
  });
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" className="btn-ghost h-9 min-h-0 px-3 text-small" disabled={pending} onClick={() => setOpen((o) => !o)}><Check size={15} />{pending ? "…" : label}</button>
      {open && !pending && <WhyPick reasons={WHY} value="" onPick={close} label="Done how?" />}
      {err && <span className="mt-1 text-caption text-heart">{err}</span>}
    </span>
  );
}
