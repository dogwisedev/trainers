"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Eye, EyeOff, StickyNote, X } from "lucide-react";
import { addClientNoteAction, deleteClientNoteAction, qaFlagAction, watchAction } from "@/app/care-actions";
import { WhyPick } from "@/components/WhyPick";

type Note = { id: string; text: string; office_only: boolean; by: string | null; at: string };
const REASONS = ["Behavior concern", "Health", "Client unhappy", "New or struggling trainer", "Money or dates", "Other"];
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Admin: keep an eye on this dog. While watched, it's in the office brief with what's happened since. */
export function WatchButton({ bookingId, watch }: { bookingId: string; watch: { reason: string; by: string | null; at: string } | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const go = (on: boolean, reason = "") => start(async () => { await watchAction(bookingId, on, reason); setOpen(false); router.refresh(); });
  if (watch) return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="rounded-full bg-heart-wash px-3 py-1 text-small font-semibold text-heart"><Eye size={14} className="mr-1 inline" />Watching: {watch.reason} · {watch.by || "?"}, {day(watch.at)}</span>
      <button type="button" disabled={pending} onClick={() => go(false)} className="btn-ghost h-9 min-h-0 px-3 text-small"><EyeOff size={14} />Stop watching</button>
    </span>
  );
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" disabled={pending} onClick={() => setOpen((o) => !o)} className="btn-ghost h-9 min-h-0 px-3 text-small"><Eye size={14} />Watch this dog</button>
      {open && !pending && <WhyPick reasons={REASONS} value="" onPick={(r) => go(true, r)} label="Why?" />}
    </span>
  );
}

/** Standing notes about the client: what everyone working with them should know. Trainers see all but office-only ones. */
export function ClientNotes({ dealKey, notes, admin, path }: { dealKey: string; notes: Note[]; admin: boolean; path: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(""), [officeOnly, setOfficeOnly] = useState(false), [err, setErr] = useState("");
  return (
    <section className="panel p-4">
      <h2 className="flex items-center gap-2 text-lead font-bold"><StickyNote size={18} />Client notes</h2>
      <p className="mt-0.5 text-small text-ink-soft">What everyone working with this client should know (&ldquo;uses his own e-collar&rdquo;, &ldquo;no crate when out&rdquo;).</p>
      {notes.length > 0 && <ul className="mt-3 divide-y divide-line">{notes.map((n) => (
        <li key={n.id} className="flex items-start gap-2 py-2 text-body">
          <span className="min-w-0 flex-1">{n.text}<span className="block text-caption text-ink-faint">{n.by || "?"}, {day(n.at)}{n.office_only ? " · office only" : ""}</span></span>
          {admin && <button type="button" aria-label="Remove note" disabled={pending} onClick={() => start(async () => { await deleteClientNoteAction(n.id, path); router.refresh(); })} className="text-ink-faint"><X size={16} /></button>}
        </li>))}</ul>}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note" className="field flex-1" maxLength={400} />
        {admin && <label className="flex min-h-[44px] items-center gap-2 text-small"><input type="checkbox" checked={officeOnly} onChange={(e) => setOfficeOnly(e.target.checked)} className="h-5 w-5 accent-[#281870]" />Office only</label>}
        <button type="button" disabled={pending || text.trim().length < 3} onClick={() => start(async () => { const r = await addClientNoteAction(dealKey, text, officeOnly, path); setErr(r.ok ? "" : r.message); if (r.ok) { setText(""); setOfficeOnly(false); router.refresh(); } })} className="btn-ink">{pending ? "Saving…" : "Add"}</button>
      </div>
      {err && <p role="alert" className="mt-1 text-small text-heart">{err}</p>}
    </section>
  );
}

const QA = ["Complaint", "Needs support", "Behavior, safety or health", "Program or pickup to review", "Refund, cancellation or dispute", "Other"];
/** QA box: stop every automated email to this client (feedback asks, follow-up chasing, reviews, promotions). */
export function QaFlagButton({ bookingId, flag }: { bookingId: string; flag: { reason: string; by: string; at: string } | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (flag) return <span className="rounded-full bg-biscuit-wash px-3 py-1 text-small font-semibold text-warn">QA box: {flag.reason} · {flag.by}, {day(flag.at)}</span>;
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" disabled={pending} onClick={() => setOpen((o) => !o)} className="btn-ghost h-9 min-h-0 px-3 text-small">{pending ? "Flagging in HubSpot…" : "QA flag"}</button>
      {open && !pending && <WhyPick reasons={QA} value="" onPick={(r) => start(async () => { const x = await qaFlagAction(bookingId, r); setMsg({ ok: x.ok, text: x.message }); setOpen(false); router.refresh(); })} label="Why? (stops all automated emails to this client)" />}
      {msg && <span role="status" className={`mt-1 text-caption ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</span>}
    </span>
  );
}
