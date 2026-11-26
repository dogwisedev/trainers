"use client";
import { useRef, useState } from "react";
import { Camera, Check, RotateCcw } from "lucide-react";
import { uploadToDrive } from "@/lib/driveUpload";
import { fileType, mediaKind, shrinkPhoto } from "@/lib/uploadPrep";
import type { MediaItem } from "@/lib/reports";

// Photos and videos for a weekly health check ("Snout to tail"). Unlike components/FormUpload.tsx these do NOT go into the
// dog's chat: they are saved with the form (in the booking's Drive folder, not the chat's "All media" folder the client can
// open) and wait there. The office looks at them with the form, and sends them to the chat with "Send media in chat" once
// the form is approved. A client once saw a cut on a nose in a video before anyone had explained it.
type Job = { key: number; file: File; progress: number; note: string; error: string; done: boolean };

export function FormHeldUpload({ bookingId, label, onAdded, demo }: { bookingId: string; label: string; onAdded: (items: Omit<MediaItem, "slot" | "description">[]) => void; demo: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const seq = useRef(0), input = useRef<HTMLInputElement>(null);
  const patch = (key: number, j: Partial<Job>) => setJobs((cur) => cur.map((x) => (x.key === key ? { ...x, ...j } : x)));
  const run = async (job: Job) => {
    patch(job.key, { error: "", note: "", progress: 0 });
    try {
      if (demo) throw new Error("Uploads are off in the demo.");
      let type = fileType(job.file), blob: Blob = job.file, name = job.file.name;
      if (!/^(image|video)\//.test(type)) throw new Error("Only photos and videos can be added here.");
      if (type.startsWith("image/")) { patch(job.key, { note: "Getting the photo ready…" }); const s = await shrinkPhoto(job.file); blob = s.blob; name = s.name; type = s.type; }
      const r = await fetch("/api/drive/report-media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId, name, type, size: blob.size, slot: "health" }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || `Couldn't start the upload (${r.status}). Check your signal and try again.`);
      await uploadToDrive(blob, d.uploadUrl, (sent) => patch(job.key, { progress: sent / blob.size, note: "" }), (note) => patch(job.key, { note }));
      // The server finds the file and signs it, so the form can keep it
      let got: { id?: string; sig?: string } = {};
      for (let i = 0; !got.id && i < 4; i++) {
        patch(job.key, { note: "Finishing…", progress: 1 });
        const c = await fetch("/api/drive/report-media/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId, storedName: d.storedName }) });
        const cd = await c.json().catch(() => ({}));
        if (c.ok && cd.id) got = cd; else await new Promise((res) => setTimeout(res, 2500));
      }
      if (!got.id || !got.sig) throw new Error("It reached Google Drive but the app couldn't find it yet. Tap Try again.");
      onAdded([{ id: got.id, name, kind: mediaKind(type) === "photo" ? "photo" : "video", sig: got.sig, size: blob.size }]);
      patch(job.key, { done: true, progress: 1, note: "" });
    } catch (e) {
      patch(job.key, { error: typeof navigator !== "undefined" && !navigator.onLine ? "No signal. Tap Try again when you're back online." : (e as Error).message, note: "" });
    }
  };
  const add = (files: FileList | null) => {
    if (!files?.length) return;
    const added = [...files].map((file) => ({ key: ++seq.current, file, progress: 0, note: "", error: "", done: false }));
    setJobs((cur) => [...cur, ...added]);
    added.reduce((chain, j) => chain.then(() => run(j)), Promise.resolve());
    if (input.current) input.current.value = "";
  };
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paper p-3">
      <input ref={input} type="file" accept="image/*,video/*" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => add(e.target.files)} />
      <button type="button" className="btn-ink h-11 min-h-0 w-full px-4 text-body sm:w-auto" disabled={demo} onClick={() => input.current?.click()}><Camera size={17} />{label}</button>
      <p className="mt-2 text-small text-ink-soft">Keep this page open until each one says Added.</p>
      {jobs.length > 0 && (
        <ul className="mt-2 space-y-2" aria-live="polite">
          {jobs.map((j) => (
            <li key={j.key} className="rounded-xl bg-white p-2.5 text-body">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold">{j.file.name}</span>
                {j.done ? <span className="inline-flex shrink-0 items-center gap-1 text-small font-semibold text-fern"><Check size={15} />Added</span>
                  : j.error ? <button type="button" className="btn-ghost h-9 min-h-0 shrink-0 px-3 text-small" onClick={() => run(j)}><RotateCcw size={14} />Try again</button>
                  : <span className="shrink-0 text-small tabular-nums text-ink-soft">{Math.round(j.progress * 100)}%</span>}
              </div>
              {!j.done && !j.error && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full bg-lav transition-all" style={{ width: `${Math.max(4, j.progress * 100)}%` }} /></div>}
              {(j.note || j.error) && <p className={`mt-1.5 text-small ${j.error ? "text-heart" : "text-ink-soft"}`}>{j.error || j.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
