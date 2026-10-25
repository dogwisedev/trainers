"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";

/** Search box (names and message text) and, for admins, a trainer filter. Works through the page URL, so it can be shared and refreshed. */
export function ChatFilters({ base, q, t, f, trainers, placeholder = "Search dog, client or messages" }: { base: string; q: string; t?: string; f?: string; trainers?: { id: string; name: string }[]; placeholder?: string }) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const go = (next: { t?: string; q?: string }) => {
    const p = new URLSearchParams();
    if (f) p.set("f", f);
    const tt = next.t ?? t ?? "", qq = (next.q ?? text).trim();
    if (tt) p.set("t", tt);
    if (qq) p.set("q", qq);
    const qs = p.toString();
    router.push(qs ? `${base}?${qs}` : base);
  };
  return (
    <form role="search" className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); go({}); }}>
      {trainers && (
        <>
          <label htmlFor="chat-trainer" className="sr-only">Trainer</label>
          <select id="chat-trainer" className="field h-11 w-auto min-w-[150px] flex-none py-0 text-[14px]" value={t || ""} onChange={(e) => go({ t: e.target.value })}>
            <option value="">All trainers</option>
            {trainers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </>
      )}
      <div className="relative order-first min-w-[180px] flex-1 basis-full sm:order-none sm:basis-auto">
        <label htmlFor="chat-search" className="sr-only">Search chats</label>
        <input id="chat-search" type="search" className="field pr-10" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-ink-soft" aria-label="Search"><Search size={17} /></button>
      </div>
      {(q || t) && <button type="button" className="btn-ghost h-11 min-h-0 px-3 text-[14px]" onClick={() => { setText(""); router.push(f ? `${base}?f=${f}` : base); }}><X size={16} />Clear</button>}
    </form>
  );
}
