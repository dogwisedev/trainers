"use client";
import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Play, X } from "lucide-react";
import { MediaRef, driveDownload, drivePreview, driveThumb, driveView } from "@/lib/chatTypes";

const mb = (n: number) => `${(n / 1048576).toFixed(n > 1e8 ? 0 : 1)} MB`;
// Drive makes thumbnails a little after an upload: try again after 5 s, 15 s, 45 s and 2 min before giving up
const RETRY_MS = [5000, 15000, 45000, 120000];

/** A Drive thumbnail that waits for Drive to make it (instead of breaking for good on the first miss). */
function Thumb({ id, local, alt, className, onGiveUp }: { id: string; local?: string; alt: string; className: string; onGiveUp?: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [gone, setGone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  if (gone) return null;
  const src = local || `${driveThumb(id, 800)}${attempt ? `&r=${attempt}` : ""}`;
  return (
    <>
      {!loaded && <div className={`skeleton ${className}`} aria-hidden />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={src} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className={`${className} ${loaded ? "" : "hidden"}`}
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (local || attempt >= RETRY_MS.length) { setGone(true); onGiveUp?.(); return; }
          timer.current = setTimeout(() => setAttempt((a) => a + 1), RETRY_MS[attempt]);
        }} />
    </>
  );
}

/** One photo, video or PDF in a chat. Tapping it opens it inside the app. */
export function MediaCard({ m, local, onOpen, dark = false }: { m: MediaRef; local?: string; onOpen: (m: MediaRef) => void; dark?: boolean }) {
  const [noThumb, setNoThumb] = useState(false);
  const isFile = m.kind === "file";
  return (
    <div className={`overflow-hidden rounded-2xl border ${dark ? "border-white/15" : "border-line"} bg-white text-ink`}>
      {!isFile && !noThumb ? (
        <button type="button" onClick={() => onOpen(m)} className="relative block w-full" aria-label={`Open ${m.name}`}>
          <Thumb id={m.id} local={m.kind === "photo" ? local : undefined} alt={m.name} className="max-h-80 min-h-[120px] w-full object-cover" onGiveUp={() => setNoThumb(true)} />
          {m.kind === "video" && <span className="absolute inset-0 grid place-items-center"><span className="grid h-14 w-14 place-items-center rounded-full bg-ink/70 text-white"><Play size={26} className="ml-1" /></span></span>}
        </button>
      ) : (
        <button type="button" onClick={() => onOpen(m)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-paper/60">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-paper text-ink">{m.kind === "video" ? <Play size={20} /> : <FileText size={20} />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{m.name}</span><span className="text-small text-ink-soft">{m.kind === "video" ? "Video" : isFile ? "Document" : "Photo"}{m.size ? `, ${mb(m.size)}` : ""} · Tap to open</span></span>
        </button>
      )}
      {!isFile && !noThumb && (
        <div className="flex items-center gap-2 px-3 py-2 text-small">
          <span className="min-w-0 flex-1 truncate text-ink-soft">{m.name}{m.size ? ` (${mb(m.size)})` : ""}</span>
          <a href={driveDownload(m.id)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper text-ink" aria-label="Download"><Download size={16} /></a>
        </div>
      )}
    </div>
  );
}

/** Full-screen viewer: photos large, videos and PDFs in Drive's player. Close with X or Escape. */
export function MediaViewer({ m, onClose }: { m: MediaRef | null; onClose: () => void }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => {
    if (!m) return;
    setPhotoFailed(false);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", key); };
  }, [m, onClose]);
  if (!m) return null;
  const photo = m.kind === "photo" && !photoFailed;
  return (
    <div role="dialog" aria-modal="true" aria-label={m.name} className="fixed inset-0 z-50 flex flex-col bg-[#120B33]/95 text-white">
      <div className="flex items-center gap-2 px-3 pb-2 pt-[max(10px,env(safe-area-inset-top))]">
        <p className="min-w-0 flex-1 truncate text-body font-semibold">{m.name}</p>
        <a href={driveDownload(m.id)} className="grid h-11 w-11 place-items-center rounded-full hover:bg-[rgb(255_255_255/0.1)]" aria-label="Download"><Download size={20} /></a>
        <a href={driveView(m.id)} target="_blank" rel="noopener" className="grid h-11 w-11 place-items-center rounded-full hover:bg-[rgb(255_255_255/0.1)]" aria-label="Open in Google Drive"><ExternalLink size={19} /></a>
        <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full bg-[rgb(255_255_255/0.1)] hover:bg-[rgb(255_255_255/0.2)]" aria-label="Close"><X size={22} /></button>
      </div>
      <div className="relative min-h-0 flex-1 px-2 pb-[max(12px,env(safe-area-inset-bottom))]">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={driveThumb(m.id, 2000)} alt={m.name} referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} className="h-full w-full object-contain" />
        ) : (
          <iframe src={drivePreview(m.id)} title={m.name} allow="autoplay; fullscreen" allowFullScreen className="h-full w-full rounded-xl border-0 bg-black" />
        )}
      </div>
    </div>
  );
}
