"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { Avatar } from "@/components/ui";

/** The bar at the top of a chat. It stays in view while the chat scrolls, so the way back and "Info" are always one tap
 *  away, and it is one line tall so the messages get the screen. Everything else about the chat (the dog's page, HubSpot,
 *  the client's access, quiet and close) is inside Info: closed until asked for, open by itself when something needs doing
 *  (`attention`). */
export function ChatHeader({ backHref, title, subtitle, actions, info, attention, openAtStart = false }: {
  backHref: string; title: string; subtitle?: ReactNode; actions?: ReactNode; info?: ReactNode; attention?: string | null; openAtStart?: boolean;
}) {
  const [open, setOpen] = useState(openAtStart);
  const [top, setTop] = useState(0);
  // On a phone the app's own top bar is fixed above: sit right under it, whatever its height (safe areas differ by phone)
  useEffect(() => {
    const measure = () => { const bar = document.querySelector<HTMLElement>("[data-app-bar]"); setTop(bar && bar.offsetParent !== null ? bar.offsetHeight : 0); };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return (
    <div style={{ top }} className="sticky z-10 -mx-4 mb-3 border-b border-line/60 bg-[rgb(var(--canvas)/0.94)] px-4 py-2 backdrop-blur-md md:-mx-8 md:px-8">
      <div className="flex items-center gap-2">
        <Link prefetch={false} href={backHref} className="-ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-mint-wash" aria-label="All chats"><ChevronLeft /></Link>
        <Avatar name={title} size={36} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lead font-extrabold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-small text-ink-soft">{subtitle}</p>}
        </div>
        {actions}
        {info && (
          <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className={`relative flex h-10 shrink-0 items-center gap-1 rounded-full border px-3 text-small font-semibold ${open ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-paper"}`}>
            Info<ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
            {attention && !open && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-heart ring-2 ring-white" aria-label={attention} />}
          </button>
        )}
      </div>
      {attention && !open && <button type="button" onClick={() => setOpen(true)} className="mt-1.5 block w-full truncate rounded-lg bg-heart-wash px-2.5 py-1 text-left text-small font-semibold text-heart">{attention}</button>}
      {info && open && <div className="mt-2 max-h-[62dvh] space-y-3 overflow-y-auto rounded-2xl border border-line bg-white p-3.5 shadow-card">{info}</div>}
    </div>
  );
}
