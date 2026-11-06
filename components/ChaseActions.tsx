"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MessageCircle, MessageSquareText, Phone } from "lucide-react";
import { checkInAction, logCallAction, type CheckIn } from "@/app/nudge-actions";
import type { ChaseInfo } from "@/lib/nudges";

const telOf = (p: string | null) => { const d = String(p || "").replace(/[^\d+]/g, ""); return d.replace(/\D/g, "").length >= 7 ? `tel:${d}` : null; };

/** Check in with the trainer on an item the reminders handed to the office: Call, or a message (the app's suggestion,
 *  editable) sent in the app or as a text. Everything is logged; the item clears itself when the trainer acts. */
export function ChaseActions({ c }: { c: ChaseInfo }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [text, setText] = useState(c.suggested);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const who: CheckIn = { ref: c.ref, kind: c.kind, trainerId: c.trainerId, chatId: c.chatId, bookingId: c.bookingId };
  const tel = telOf(c.phone), first = c.trainerName.replace(/".*?"\s*/, "").split(" ")[0];
  const send = (channel: "app" | "text") => start(async () => {
    const r = await checkInAction(who, channel, text, c.suggested);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { setOpen(false); router.refresh(); }
  });
  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        {tel && <a href={tel} onClick={() => { void logCallAction(who); }} className="btn-ghost h-9 min-h-0 px-3 text-small"><Phone size={14} />Call {first}</a>}
        {!open && <button type="button" onClick={() => { setOpen(true); setMsg(null); }} className="btn-ghost h-9 min-h-0 px-3 text-small"><MessageCircle size={14} />Message {first}</button>}
      </div>
      {open && (
        <div className="mt-2 rounded-xl border border-line bg-paper/50 p-3">
          <label className="block">
            <span className="label">Suggested message to {first}: change anything you like</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="field" />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={pending || !text.trim()} onClick={() => send("app")} className="btn-ink h-10 min-h-0 px-3.5 text-small"><MessageCircle size={15} />{pending ? "Sending…" : "Send in app"}</button>
            {c.canText && <button type="button" disabled={pending || !text.trim()} onClick={() => send("text")} className="btn-ghost h-10 min-h-0 px-3.5 text-small"><MessageSquareText size={15} />Send as text</button>}
            <button type="button" disabled={pending} onClick={() => { setOpen(false); setText(c.suggested); }} className="btn-ghost h-10 min-h-0 px-3 text-small">Cancel</button>
          </div>
        </div>
      )}
      {msg && <p role="status" className={`mt-2 text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </div>
  );
}
