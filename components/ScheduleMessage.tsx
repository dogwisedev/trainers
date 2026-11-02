"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, Check, Clock, X } from "lucide-react";
import { cancelScheduledAction, scheduleMessageAction } from "@/app/chat-actions";
import { uploadToDrive } from "@/lib/driveUpload";
import { fileType, mediaKind, shrinkPhoto } from "@/lib/uploadPrep";
import type { MediaRef } from "@/lib/chatTypes";

// Scheduled send (trainers and the office). The clock next to Send opens a sheet: write the message, add photos or
// videos, pick when. The 10-minute chat job posts it at that time, as you. Until then the client sees nothing.
// Pending ones show in a strip above the composer, with Cancel.

export type ScheduledLite = { id: string; body: string | null; media: MediaRef[]; send_at: string; sender_name: string | null; mine: boolean };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** A local datetime-local value for a date at a given hour. */
const local = (d: Date, hour: number) => { const x = new Date(d); x.setHours(hour, 0, 0, 0); const p = (n: number) => String(n).padStart(2, "0"); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };

export function ScheduleButton({ chatId, text, onScheduled, disabled }: { chatId: string; text: string; onScheduled: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-paper disabled:opacity-40" aria-label="Schedule a message"><Clock size={20} /></button>
      {open && <ScheduleSheet chatId={chatId} initialText={text} onClose={() => setOpen(false)} onScheduled={() => { setOpen(false); onScheduled(); }} />}
    </>
  );
}

type Job = { key: number; name: string; progress: number; error: string; ref?: MediaRef };
function ScheduleSheet({ chatId, initialText, onClose, onScheduled }: { chatId: string; initialText: string; onClose: () => void; onScheduled: () => void }) {
  const [text, setText] = useState(initialText);
  const [at, setAt] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return local(d, 9); });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const seq = useRef(0), input = useRef<HTMLInputElement>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);
  const patch = (key: number, j: Partial<Job>) => setJobs((cur) => cur.map((x) => (x.key === key ? { ...x, ...j } : x)));
  const upload = async (job: Job, file: File) => {
    try {
      let type = fileType(file), blob: Blob = file, name = file.name;
      if (!/^(image|video)\//.test(type)) throw new Error("Photos and videos only.");
      if (type.startsWith("image/")) { const s = await shrinkPhoto(file); blob = s.blob; name = s.name; type = s.type; }
      const r = await fetch("/api/chat/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, name, type, size: blob.size }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || `Couldn't start the upload (${r.status}).`);
      let id = await uploadToDrive(blob, d.uploadUrl, (sent) => patch(job.key, { progress: sent / blob.size }), () => {});
      for (let i = 0; !id && i < 3; i++) { const c = await fetch("/api/chat/media/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, storedName: d.storedName }) }); const cd = await c.json().catch(() => ({})); if (c.ok && cd.id) id = cd.id; else await new Promise((res) => setTimeout(res, 2500)); }
      if (!id) throw new Error("Uploaded, but Drive hasn't confirmed it yet. Remove it and try again.");
      patch(job.key, { progress: 1, ref: { id, name, kind: mediaKind(type) as MediaRef["kind"], size: blob.size } });
    } catch (e) { patch(job.key, { error: (e as Error).message }); }
  };
  const add = (files: FileList | null) => { if (!files?.length) return; const added = [...files].map((file) => ({ key: ++seq.current, name: file.name, progress: 0, error: "", file })); setJobs((cur) => [...cur, ...added.map(({ file: _f, ...j }) => j)]); added.reduce((chain, j) => chain.then(() => upload(j, j.file)), Promise.resolve()); if (input.current) input.current.value = ""; };
  const refs = jobs.filter((j) => j.ref).map((j) => j.ref!), uploading = jobs.some((j) => !j.ref && !j.error);
  const quick = (days: number, hour: number) => { const d = new Date(); d.setDate(d.getDate() + days); setAt(local(d, hour)); };
  const submit = () => start(async () => {
    setMsg("");
    const r = await scheduleMessageAction(chatId, text, refs, new Date(at).toISOString());
    if (r.ok) onScheduled(); else setMsg(r.message);
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 md:items-center md:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="sched-title" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[22px] bg-white p-4 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-card md:max-w-lg md:rounded-[22px]">
        <div className="flex items-center justify-between"><h2 id="sched-title" className="text-lead font-extrabold">Schedule a message</h2><button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full hover:bg-paper" aria-label="Close"><X size={18} /></button></div>
        <p className="mt-1 text-small text-ink-soft">It&apos;s posted in the chat at the time you pick, as you. The client sees nothing until then.</p>
        <label className="mt-3 block"><span className="label">Message</span><textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="field min-h-[96px]" placeholder="Write the update" /></label>
        <div className="mt-3">
          <input ref={input} type="file" accept="image/*,video/*" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => add(e.target.files)} />
          <button type="button" onClick={() => input.current?.click()} className="btn-ghost h-10 min-h-0 px-3 text-small"><Camera size={16} />Add photos or videos</button>
          {jobs.length > 0 && <ul className="mt-2 space-y-1">{jobs.map((j) => <li key={j.key} className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-small"><span className="min-w-0 truncate">{j.name}</span>{j.ref ? <span className="inline-flex items-center gap-1 text-fern"><Check size={14} />Ready</span> : j.error ? <span className="text-heart">{j.error}</span> : <span className="tabular-nums text-ink-soft">{Math.round(j.progress * 100)}%</span>}<button type="button" onClick={() => setJobs((c) => c.filter((x) => x.key !== j.key))} className="text-ink-faint hover:text-ink" aria-label="Remove"><X size={14} /></button></li>)}</ul>}
        </div>
        <div className="mt-3">
          <span className="label">When</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {[["Tomorrow 9 AM", 1, 9], ["Tomorrow 6 PM", 1, 18], ["In 2 days, 9 AM", 2, 9], ["In 3 days, 9 AM", 3, 9]].map(([l, d, h]) => <button key={String(l)} type="button" onClick={() => quick(Number(d), Number(h))} className="chip">{l}</button>)}
          </div>
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="field mt-2 h-11" aria-label="Date and time" />
          <p className="mt-1 text-caption text-ink-faint">Your time. It goes out within 10 minutes of that.</p>
        </div>
        {msg && <p role="alert" className="mt-3 text-small font-semibold text-heart">{msg}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={submit} disabled={pending || uploading || (!text.trim() && !refs.length)} className="btn-ink flex-1">{pending ? "Scheduling…" : uploading ? "Uploading…" : "Schedule"}</button>
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function ScheduledStrip({ items, canCancelAll }: { items: ScheduledLite[]; canCancelAll: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!items.length) return null;
  return (
    <details className="group mt-3 rounded-2xl border border-line bg-paper/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-small font-semibold [&::-webkit-details-marker]:hidden"><Clock size={15} className="text-ink-soft" />{items.length} scheduled · next {when(items[0].send_at)}<span className="ml-auto text-caption text-ink-faint group-open:hidden">Show</span></summary>
      <ul className="divide-y divide-line border-t border-line">
        {items.map((m) => (
          <li key={m.id} className="flex items-start gap-3 px-4 py-2.5 text-small">
            <div className="min-w-0 flex-1"><p className="font-semibold">{when(m.send_at)}{m.sender_name ? <span className="font-normal text-ink-soft"> · {m.sender_name}</span> : null}</p><p className="truncate text-ink-soft">{m.body || ""}{m.media.length ? ` ${m.body ? "·" : ""} ${m.media.length} photo${m.media.length > 1 ? "s" : ""}/video${m.media.length > 1 ? "s" : ""}` : ""}</p></div>
            {(m.mine || canCancelAll) && <button type="button" disabled={pending} onClick={() => start(async () => { await cancelScheduledAction(m.id); router.refresh(); })} className="btn-ghost h-8 min-h-0 shrink-0 px-2.5 text-caption">Cancel</button>}
          </li>
        ))}
      </ul>
    </details>
  );
}
