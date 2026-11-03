"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarPlus, PauseCircle, XCircle } from "lucide-react";
import { cancelDealAction, standbyDealAction } from "@/app/actions";
import { CANCEL_REASONS } from "@/lib/cancelReasons";

// A Closed Won deal that isn't booked: Book now, Standby (note + a reminder day, or none) or Cancelled (HubSpot's reason).
// There's no plain Done: every deal ends up booked, on Standby, or Cancelled in HubSpot.
export function DealDecision({ dealId, bookHref, note: initialNote = "", remindOn: initialRemind = null, onStandby = false }: { dealId: string; bookHref: string; note?: string; remindOn?: string | null; onStandby?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<"" | "standby" | "cancel">("");
  const [note, setNote] = useState(initialNote), [remind, setRemind] = useState<"date" | "none">(initialRemind || !onStandby ? "date" : "none");
  const [day, setDay] = useState(initialRemind || (() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); })());
  const [reason, setReason] = useState(""), [cnote, setCnote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (f: () => Promise<{ ok: boolean; message: string }>) => start(async () => { const r = await f(); setMsg({ ok: r.ok, text: r.message }); if (r.ok) { setOpen(""); router.refresh(); } });
  return (
    <div className="mt-2 w-full">
      <div className="flex flex-wrap gap-2">
        <Link prefetch={false} href={bookHref} className="btn-ink h-9 min-h-0 px-3 text-small"><CalendarPlus size={15} />Book now</Link>
        <button type="button" onClick={() => setOpen(open === "standby" ? "" : "standby")} aria-expanded={open === "standby"} className="btn-ghost h-9 min-h-0 px-3 text-small"><PauseCircle size={15} />{onStandby ? "Update standby" : "Standby"}</button>
        <button type="button" onClick={() => setOpen(open === "cancel" ? "" : "cancel")} aria-expanded={open === "cancel"} className="btn-ghost h-9 min-h-0 px-3 text-small"><XCircle size={15} />Cancelled</button>
      </div>
      {open === "standby" && (
        <div className="mt-2 space-y-2 rounded-xl border border-line bg-paper/60 p-3">
          <label className="block"><span className="label">Why is it on standby?</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className="field" placeholder="e.g. Client moving house, wants to start in January" /></label>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body">
            <label className="flex items-center gap-2"><input type="radio" name={`r-${dealId}`} checked={remind === "date"} onChange={() => setRemind("date")} />Remind me on</label>
            <input type="date" value={day} onChange={(e) => { setDay(e.target.value); setRemind("date"); }} className="field h-10 w-auto px-2" aria-label="Reminder day" />
            <label className="flex items-center gap-2"><input type="radio" name={`r-${dealId}`} checked={remind === "none"} onChange={() => setRemind("none")} />No reminder, keep it on the Standby list</label>
          </div>
          <div className="flex gap-2"><button type="button" disabled={pending || !note.trim()} onClick={() => run(() => standbyDealAction(dealId, note, remind === "date" ? day : null))} className="btn-ink h-9 min-h-0 px-3 text-small">{pending ? "Saving…" : "Put on standby"}</button>
            <button type="button" onClick={() => setOpen("")} className="btn-ghost h-9 min-h-0 px-3 text-small">Back</button></div>
          <p className="text-caption text-ink-faint">Sets Client Status to Standby in HubSpot.</p>
        </div>
      )}
      {open === "cancel" && (
        <div className="mt-2 space-y-2 rounded-xl border border-heart/30 bg-heart-wash p-3">
          <label className="block"><span className="label">Why was it cancelled?</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="field"><option value="">Pick one…</option>{CANCEL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          <label className="block"><span className="label">More detail{reason === "Other" ? "" : " (optional)"}</span>
            <textarea value={cnote} onChange={(e) => setCnote(e.target.value)} rows={2} maxLength={1000} className="field" /></label>
          <div className="flex gap-2"><button type="button" disabled={pending || !reason || (reason === "Other" && !cnote.trim())} onClick={() => run(() => cancelDealAction(dealId, reason, cnote))} className="btn-danger h-9 min-h-0 px-3 text-small">{pending ? "Saving…" : "Mark cancelled"}</button>
            <button type="button" onClick={() => setOpen("")} className="btn-ghost h-9 min-h-0 px-3 text-small">Back</button></div>
          <p className="text-caption text-ink-soft">Sets Client Status to Cancelled in HubSpot, with this reason.</p>
        </div>
      )}
      {msg && <p role="status" className={`mt-2 text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </div>
  );
}
