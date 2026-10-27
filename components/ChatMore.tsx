"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ClipboardList, MoreHorizontal, TriangleAlert } from "lucide-react";

/** Chat header: a clear "Info" button (the dog and client's details, with what's still missing), and ⋯ for Report incident. */
export function ChatMore({ profileHref, left, incidentHref }: { profileHref?: string | null; left: number | null; incidentHref?: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("touchstart", away); window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("touchstart", away); window.removeEventListener("keydown", key); };
  }, [open]);
  if (!profileHref && !incidentHref) return null;
  return (
    <div ref={ref} className="relative flex shrink-0 items-center gap-1.5">
      {profileHref && (
        <Link href={profileHref} data-tour="dog-info" className="relative flex h-11 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 font-semibold text-ink hover:bg-paper" aria-label="Dog and client info">
          <ClipboardList size={18} className="text-lav-deep" />Info
          {left !== null && left > 0 && <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-heart px-1 text-micro font-bold text-white ring-2 ring-white">{left}</span>}
        </Link>
      )}
      {incidentHref && (
        <button type="button" data-tour="chat-more" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-haspopup="menu" aria-label="More"
          className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-ink hover:bg-paper">
          <MoreHorizontal size={20} />
        </button>
      )}
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-30 w-64 overflow-hidden rounded-2xl border border-line bg-white shadow-lift">
          {incidentHref && (
            <Link role="menuitem" href={incidentHref} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-3.5 text-heart hover:bg-heart-wash">
              <TriangleAlert size={18} />
              <span className="flex-1"><span className="block font-semibold">Report incident</span><span className="text-small text-ink-soft">Injury, escape, bite, illness</span></span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
