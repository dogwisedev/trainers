"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarCheck, CalendarPlus, Clock, X } from "lucide-react";
import { requestFollowupAction } from "@/app/followup-actions";

// Client chat, once the training is complete: "Book your follow-up". Pick up to 3 days that suit (and a part of the day),
// the request goes into the chat for the trainer, who replies with a time. Then the card shows what's booked.
export type FollowupCard = { n: number | null; dog: string; trainer: string; requested: number | null; upcoming: { n: number; at: string } | null; done: number };
const PARTS = ["Morning", "Afternoon", "Evening", "Any time"];
const plus = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

export function FollowupRequest({ chatId, card }: { chatId: string; card: FollowupCard }) {
  const [open, setOpen] = useState(false);
  const first = card.trainer.split(" ")[0];
  if (card.upcoming) return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl border border-mint-deep/30 bg-mint-wash p-3">
      <CalendarCheck size={22} className="shrink-0 text-fern" />
      <p className="text-body"><b>Follow-up session {card.upcoming.n}</b> with {first}: {new Date(card.upcoming.at).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
    </div>
  );
  if (card.requested) return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl border border-line bg-paper p-3">
      <Clock size={22} className="shrink-0 text-ink-soft" />
      <p className="text-body">You asked for follow-up session {card.requested}. {first} will reply here with a time.</p>
    </div>
  );
  if (!card.n) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mb-3 flex w-full items-center gap-3 rounded-2xl border-2 border-ink bg-white p-3.5 text-left shadow-card">
        <CalendarPlus size={24} className="shrink-0 text-ink" />
        <span className="min-w-0 flex-1"><b className="block text-lead">Book your follow-up</b><span className="text-small text-ink-soft">Session {card.n} of 3 with {first}{card.done ? ` · ${card.done} done` : ""}</span></span>
        <span className="btn-ink h-10 min-h-0 shrink-0 px-4 text-body">Book</span>
      </button>
      {open && <Sheet chatId={chatId} card={card} onClose={() => setOpen(false)} />}
    </>
  );
}

function Sheet({ chatId, card, onClose }: { chatId: string; card: FollowupCard; onClose: () => void }) {
  const router = useRouter();
  const [opts, setOpts] = useState([{ day: plus(3), part: "Morning" }, { day: plus(4), part: "Afternoon" }, { day: "", part: "Any time" }]);
  const [note, setNote] = useState(""), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, k: "day" | "part", v: string) => setOpts((cur) => cur.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  const send = () => start(async () => {
    const r = await requestFollowupAction(chatId, opts.filter((o) => o.day), note);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { setTimeout(() => { onClose(); router.refresh(); }, 1200); }
  });
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/40 md:items-center md:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="fu-title" className="flex max-h-[88vh] w-full flex-col rounded-t-[22px] bg-white shadow-card md:max-w-lg md:rounded-[22px]">
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          <h2 id="fu-title" className="text-lead font-extrabold">Book follow-up session {card.n}</h2>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full hover:bg-paper" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          <p className="mt-1 text-body text-ink-soft">Pick a few days that suit you. {card.trainer.split(" ")[0]} will reply in the chat with a time.</p>
          {opts.map((o, i) => (
            <div key={i} className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <label className="block"><span className="label">{i === 0 ? "First choice" : i === 1 ? "Second choice" : "Third choice (optional)"}</span>
                <input type="date" min={plus(1)} value={o.day} onChange={(e) => set(i, "day", e.target.value)} className="field h-12" /></label>
              <label className="block"><span className="label">Time</span>
                <select value={o.part} onChange={(e) => set(i, "part", e.target.value)} className="field h-12 w-auto">{PARTS.map((p) => <option key={p}>{p}</option>)}</select></label>
            </div>
          ))}
          <label className="mt-3 block"><span className="label">Anything to work on? (optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} className="field" placeholder="e.g. Still pulling on the leash near other dogs" /></label>
          {msg && <p role="status" className={`mt-3 text-body font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-line px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <button type="button" onClick={send} disabled={pending || !opts.some((o) => o.day)} className="btn-ink flex-1">{pending ? "Sending…" : "Send request"}</button>
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}
