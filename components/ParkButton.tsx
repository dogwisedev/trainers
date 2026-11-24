"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Clock3, Undo2 } from "lucide-react";
import { parkAction, unparkAction, type ParkWhen } from "@/app/park-actions";

const chip = (on: boolean) => `min-h-[38px] rounded-full border px-3 text-small ${on ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-soft"}`;
const WHEN: [ParkWhen, string][] = [["4h", "In 4 hours"], ["tomorrow", "Tomorrow, 9 AM"], ["2d", "In 2 days"]];

/** "I've done my bit, check back in…": says what was done, then when it should come back. Two taps. The third park is the
 *  last; after it the item can't be parked again. */
export function ParkButton({ keys, parks, options, trainerId, what, label }: { keys: string[]; parks: number; options: string[]; trainerId?: string; what: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false), [did, setDid] = useState(""), [msg, setMsg] = useState("");
  // Three parks used: it can't be parked again. It stays in Needs you until it's dealt with.
  if (parks >= 3) return <span className="inline-flex h-10 items-center rounded-full bg-biscuit-wash px-3.5 text-small font-semibold text-warn">No parks left. You can run, but you can&apos;t hide 🐾</span>;
  const last = parks === 2;
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" disabled={pending} aria-expanded={open} onClick={() => { setOpen((o) => !o); setMsg(""); }} className={`h-10 min-h-0 px-3.5 text-small ${last ? "btn-ghost border-biscuit text-warn" : "btn-ghost"}`}><Clock3 size={15} />{pending ? "Parking…" : last ? "Final park" : label || "Park"}</button>
      {open && !pending && (
        <span className="mt-2 block w-full max-w-md rounded-2xl border border-line bg-paper/70 p-3">
          {last && <span className="mb-2 block text-small font-semibold text-warn">This is the last park: after it, it stays on your list until it&apos;s dealt with.</span>}
          <span className="mb-1 block text-caption font-semibold text-ink-soft">1. What did you do?</span>
          <span className="flex flex-wrap gap-1.5">{options.map((o) => <button key={o} type="button" aria-pressed={did === o} onClick={() => setDid(o)} className={chip(did === o)}>{o}</button>)}</span>
          <span className={`mb-1 mt-3 block text-caption font-semibold ${did ? "text-ink-soft" : "text-ink-faint"}`}>2. Check back</span>
          <span className="flex flex-wrap gap-1.5">{WHEN.map(([k, l]) => <button key={k} type="button" disabled={!did} onClick={() => start(async () => { try { const r = await parkAction(keys, did, k, trainerId); setMsg(r.ok ? "" : r.message); if (r.ok) setOpen(false); } catch { setOpen(false); } router.refresh(); })} className={`${chip(false)} disabled:opacity-40`}>{l}</button>)}</span>
          <span className="mt-2 block text-caption text-ink-faint">It moves to Waiting and comes back by itself. If it sorts itself first, it just disappears.</span>
        </span>
      )}
      {msg && <span className="mt-1 text-caption text-heart">{msg}</span>}
    </span>
  );
}

export function UnparkButton({ itemKey }: { itemKey: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <button type="button" disabled={pending} onClick={() => start(async () => { try { await unparkAction(itemKey); } catch { /* the refresh shows it */ } router.refresh(); })} className="inline-flex min-h-[36px] items-center gap-1 text-small font-semibold text-ink-soft underline"><Undo2 size={14} />{pending ? "…" : "Bring back now"}</button>;
}
