"use client";
import { useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Camera, Check, RotateCcw } from "lucide-react";
import { notifyChatAction } from "@/app/chat-actions";
import { listChatMediaAction } from "@/app/report-actions";
import { uploadToDrive } from "@/lib/driveUpload";
import { fileType, mediaKind, newId, shrinkPhoto } from "@/lib/uploadPrep";
import type { MediaRef } from "@/lib/chatTypes";
import type { MediaItem } from "@/lib/reports";

// Photos and videos added on a form go straight into the dog's chat, so the client sees them, without the trainer leaving
// the form. Same steps as sending from the chat (components/ChatThread.tsx): shrink big photos, an upload link into the
// chat's Drive folder (/api/chat/media), the upload, then a chat message saved the same way the chat saves one (so the
// same rules decide who may post, and the same notifications go out). The first one carries a caption ("Week 2 health check").
// onAdded (handover) gets them back signed, so they can be attached to the report like ones picked from the chat.

type Job = { key: number; file: File; progress: number; note: string; error: string; done: boolean };

export function FormUpload({ chatId, bookingId, caption, label, kinds = "both", onAdded, demo }: {
  chatId: string | null; bookingId: string; caption: string; label: string; kinds?: "both" | "photo" | "video";
  onAdded?: (items: Omit<MediaItem, "slot" | "description">[]) => void; demo: boolean;
}) {
  const sb = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return !demo && url && key ? createBrowserClient(url, key) : null;
  }, [demo]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const seq = useRef(0), captioned = useRef(false), input = useRef<HTMLInputElement>(null);
  const patch = (key: number, j: Partial<Job>) => setJobs((cur) => cur.map((x) => (x.key === key ? { ...x, ...j } : x)));
  const accept = kinds === "photo" ? "image/*" : kinds === "video" ? "video/*" : "image/*,video/*";

  const run = async (job: Job) => {
    patch(job.key, { error: "", note: "", progress: 0 });
    try {
      if (!chatId || !sb) throw new Error(demo ? "Uploads are off in the demo." : "This dog has no chat yet: ask the team to start one.");
      let type = fileType(job.file), blob: Blob = job.file, name = job.file.name;
      if (!/^(image|video)\//.test(type)) throw new Error("Only photos and videos can be added here.");
      if (kinds !== "both" && mediaKind(type) !== kinds) throw new Error(kinds === "photo" ? "Pick a photo here." : "Pick a video here.");
      if (type.startsWith("image/")) { patch(job.key, { note: "Getting the photo ready…" }); const s = await shrinkPhoto(job.file); blob = s.blob; name = s.name; type = s.type; }
      // An upload link into the chat's Drive folder
      const r = await fetch("/api/chat/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, name, type, size: blob.size }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || `Couldn't start the upload (${r.status}). Check your signal and try again.`);
      let id = await uploadToDrive(blob, d.uploadUrl, (sent) => patch(job.key, { progress: sent / blob.size, note: "" }), (note) => patch(job.key, { note }));
      // Drive normally says the file's id; if not, look it up
      for (let i = 0; !id && i < 3; i++) {
        patch(job.key, { note: "Finishing…", progress: 1 });
        const c = await fetch("/api/chat/media/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, storedName: d.storedName }) });
        const cd = await c.json().catch(() => ({}));
        if (c.ok && cd.id) id = cd.id; else await new Promise((res) => setTimeout(res, 2500));
      }
      if (!id) throw new Error("It reached Google Drive but the app couldn't find it yet. Tap Try again.");
      // Post it in the chat, exactly as the chat does
      const kind = mediaKind(type) as MediaRef["kind"], ref: MediaRef = { id, name, kind, size: blob.size };
      const msgId = newId(), body = captioned.current ? null : caption;
      const { error } = await sb.from("chat_messages").insert({ id: msgId, chat_id: chatId, kind: "media", body, media: [ref] });
      if (error && error.code !== "23505") throw new Error(error.message.includes("closed") ? "This dog's chat is closed." : "Uploaded, but it couldn't be posted in the chat. Tap Try again.");
      captioned.current = true;
      notifyChatAction(chatId, msgId); // the server also notifies on its own; whichever is first sends it
      patch(job.key, { done: true, progress: 1, note: "" });
      if (onAdded) {
        const list = await listChatMediaAction(bookingId); // signed the same way as picking from the chat
        const o = list.items.find((x) => x.id === id);
        if (o) onAdded([{ id: o.id, name: o.name, kind: o.kind, sig: o.sig, size: o.size }]);
      }
    } catch (e) {
      const msg = (e as Error).message;
      patch(job.key, { error: typeof navigator !== "undefined" && !navigator.onLine ? "No signal. Tap Try again when you're back online." : msg, note: "" });
    }
  };
  const add = (files: FileList | null) => {
    if (!files?.length) return;
    const added = [...files].map((file) => ({ key: ++seq.current, file, progress: 0, note: "", error: "", done: false }));
    setJobs((cur) => [...cur, ...added]);
    added.reduce((chain, j) => chain.then(() => run(j)), Promise.resolve()); // one at a time: kind to a phone connection
    if (input.current) input.current.value = "";
  };
  const busy = jobs.some((j) => !j.done && !j.error);

  return (
    <div className="rounded-2xl border border-dashed border-line bg-paper p-3">
      <input ref={input} type="file" accept={accept} multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => add(e.target.files)} />
      <button type="button" className="btn-ink h-11 min-h-0 w-full px-4 text-body sm:w-auto" disabled={!chatId || demo} onClick={() => input.current?.click()}>
        <Camera size={17} />{label}
      </button>
      <p className="mt-2 text-small text-ink-soft">{chatId ? "They're posted in the dog's chat too, so the client sees them. Keep this page open until each one says Posted." : "This dog has no chat yet: ask the team to start one."}</p>
      {jobs.length > 0 && (
        <ul className="mt-2 space-y-2" aria-live="polite">
          {jobs.map((j) => (
            <li key={j.key} className="rounded-xl bg-white p-2.5 text-body">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold">{j.file.name}</span>
                {j.done ? <span className="inline-flex shrink-0 items-center gap-1 text-small font-semibold text-fern"><Check size={15} />Posted</span>
                  : j.error ? <button type="button" className="btn-ghost h-9 min-h-0 shrink-0 px-3 text-small" onClick={() => run(j)}><RotateCcw size={14} />Try again</button>
                  : <span className="shrink-0 text-small tabular-nums text-ink-soft">{Math.round(j.progress * 100)}%</span>}
              </div>
              {!j.done && !j.error && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full bg-lav transition-all" style={{ width: `${Math.max(4, j.progress * 100)}%` }} /></div>}
              {(j.note || j.error) && <p className={`mt-1.5 text-small ${j.error ? "text-heart" : "text-ink-soft"}`}>{j.error || j.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {busy && <span className="sr-only">Uploading</span>}
    </div>
  );
}
