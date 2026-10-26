"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { linkDealAction } from "@/app/actions";

/** Admin: paste a HubSpot deal link to connect this booking (and the client's other dogs) to the deal; chats merge into one. */
export function LinkDeal({ bookingId, hasDeal }: { bookingId: string; hasDeal: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(!hasDeal);
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" className="btn-ghost h-9 min-h-0 px-3 text-small" onClick={() => setOpen(true)}><Link2 size={14} />Change HubSpot deal</button>;
  return (
    <div className={`rounded-2xl ${hasDeal ? "border border-line" : "border border-biscuit bg-biscuit-wash/60"} p-4`}>
      <p className="font-bold">{hasDeal ? "Change HubSpot deal" : "No HubSpot deal linked"}</p>
      <p className="mt-1 text-small text-ink-soft">Paste the deal's link from HubSpot. The client's other dogs booked here by hand are linked too, and their chats merge into one.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://app.hubspot.com/contacts/…/record/0-3/12345678901" className="field min-w-0 flex-1 text-body" />
        <button type="button" className="btn-ink" disabled={pending || !url.trim()} onClick={() => start(async () => { const r = await linkDealAction(bookingId, url); setMsg({ ok: r.ok, text: r.message }); if (r.ok) { setUrl(""); router.refresh(); } })}><Link2 size={16} />{pending ? "Linking…" : "Link deal"}</button>
      </div>
      {msg && <p role="status" className={`mt-2 text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </div>
  );
}
