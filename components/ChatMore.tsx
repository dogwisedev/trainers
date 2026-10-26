"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ClipboardList, MoreHorizontal, TriangleAlert } from "lucide-react";

/** The chat's ⋯ menu: Dog profile (with what's still missing) and Report incident, out of the way of the dog's name. */
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
    <div ref={ref} className="relative shrink-0">
      <button type="button" data-tour="chat-more" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-haspopup="menu" aria-label="Dog profile and more"
        className="relative grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-ink hover:bg-paper">
        <MoreHorizontal size={20} />
        {left !== null && left > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-heart px-1 text-micro font-bold text-white ring-2 ring-white">{left}</span>}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-30 w-64 overflow-hidden rounded-2xl border border-line bg-white shadow-lift">
          {profileHref && (
            <Link role="menuitem" href={profileHref} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-3.5 hover:bg-paper">
              <ClipboardList size={18} className="text-lav-deep" />
              <span className="flex-1"><span className="block font-semibold">Dog profile</span><span className="text-small text-ink-soft">Vet, food, meds, behaviour, vaccines</span></span>
              {left !== null && (left > 0 ? <span className="rounded-full bg-heart px-2 text-caption font-bold text-white">{left} to do</span> : <span className="text-caption font-bold text-fern">Ready</span>)}
            </Link>
          )}
          {incidentHref && (
            <Link role="menuitem" href={incidentHref} onClick={() => setOpen(false)} className="flex items-center gap-3 border-t border-line px-4 py-3.5 text-heart hover:bg-heart-wash">
              <TriangleAlert size={18} />
              <span className="flex-1"><span className="block font-semibold">Report incident</span><span className="text-small text-ink-soft">Injury, escape, bite, illness</span></span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
