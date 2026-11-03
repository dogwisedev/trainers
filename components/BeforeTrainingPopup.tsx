"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ClipboardList, CreditCard } from "lucide-react";
import { visitCount } from "@/lib/visits";

/**
 * Client: a reminder of what's still needed before training. Let people settle in first: never on their first visit
 * (unless training starts within 3 days), at most once a day after that, and only after a short pause so the chat
 * loads and they can look around. The card at the top of the chat always shows the same thing, without interrupting.
 */
export function BeforeTrainingPopup({ href, left, balanceLink, dog, summary, startsInDays }: { href: string; left: number; balanceLink: string; dog: string; summary?: string; startsInDays?: number | null }) {
  const [open, setOpen] = useState(false);
  const first = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    let lastShown = "";
    const visits = visitCount(), today = new Date().toISOString().slice(0, 10), key = `dw-btp:${href}`;
    try { lastShown = localStorage.getItem(key) || ""; } catch { /* private mode */ }
    const urgent = startsInDays != null && startsInDays <= 3;
    if (lastShown === today || (visits <= 1 && !urgent)) return;
    const t = setTimeout(() => {
      setOpen(true);
      try { localStorage.setItem(key, today); sessionStorage.setItem("dw-prompted", "1"); } catch { /* fine */ }
    }, urgent ? 4000 : 8000);
    return () => clearTimeout(t);
  }, [href, startsInDays]);
  useEffect(() => { if (open) first.current?.focus(); window.dispatchEvent(new Event("dw-popup")); }, [open]);
  if (!open) return null;
  return (
    <div data-before-training-open className="fixed inset-0 z-50 grid place-items-end bg-ink/40 p-3 sm:place-items-center" onClick={() => setOpen(false)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="btp-title" className="w-full max-w-md rounded-[24px] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <ClipboardList size={28} aria-hidden />
        <h2 id="btp-title" className="mt-2 text-h2 font-extrabold leading-tight">Before {dog}&apos;s training</h2>
        <p className="mt-1 text-body text-ink-soft">{left > 0 ? (summary ? `Still needed: ${summary}.` : `${left} thing${left > 1 ? "s" : ""} still needed.`) : "Just the remaining balance left."}</p>
        <div className="mt-4 space-y-2">
          {left > 0 && <Link prefetch={false} ref={first} href={href} className="btn-ink w-full">Do it now</Link>}
          {balanceLink && <a href={balanceLink} target="_blank" rel="noopener" className={`${left > 0 ? "btn-ghost" : "btn-ink"} w-full`}><CreditCard size={17} />Pay the remaining balance</a>}
          <button type="button" className="w-full py-2 text-body font-semibold text-ink-soft" onClick={() => setOpen(false)}>Later</button>
        </div>
      </div>
    </div>
  );
}
