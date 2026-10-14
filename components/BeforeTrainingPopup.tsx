"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ClipboardList, CreditCard } from "lucide-react";

/** Client: pops up every time the chat opens while something is still missing before training. "Later" closes it until the next visit. */
export function BeforeTrainingPopup({ href, left, balanceLink, dog }: { href: string; left: number; balanceLink: string; dog: string }) {
  const [open, setOpen] = useState(false);
  const first = useRef<HTMLAnchorElement>(null);
  useEffect(() => { setOpen(true); }, []);
  useEffect(() => { if (open) first.current?.focus(); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink/40 p-3 sm:place-items-center" onClick={() => setOpen(false)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="btp-title" className="w-full max-w-md rounded-[24px] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <ClipboardList size={28} aria-hidden />
        <h2 id="btp-title" className="mt-2 text-[22px] font-extrabold leading-tight">Before {dog}&apos;s training</h2>
        <p className="mt-1 text-[15px] text-ink-soft">{left > 0 ? `${left} thing${left > 1 ? "s" : ""} still needed: a few questions, and the vaccine records. It takes a few minutes.` : "Just the remaining balance left."}</p>
        <div className="mt-4 space-y-2">
          {left > 0 && <Link ref={first} href={href} className="btn-ink w-full">Do it now</Link>}
          {balanceLink && <a href={balanceLink} target="_blank" rel="noopener" className={`${left > 0 ? "btn-ghost" : "btn-ink"} w-full`}><CreditCard size={17} />Pay the remaining balance</a>}
          <button type="button" className="w-full py-2 text-[14px] font-semibold text-ink-soft" onClick={() => setOpen(false)}>Later</button>
        </div>
      </div>
    </div>
  );
}
