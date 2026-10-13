"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeChatAction, resolveIncidentAction, takeIncidentAction } from "@/app/chat-actions";
import { Pill } from "@/components/ui";
import { INCIDENT_LABEL } from "@/lib/chatRules";
import { timeAgo } from "@/lib/dates";
import type { IncidentRow } from "@/lib/chatData";

const TONE = {
  trainer_silent: "heart", client_waiting: "heart", client_pileup: "heart", reopened: "biscuit", ready_to_close: "line",
  intake_media_missing: "biscuit", handover_photo_missing: "biscuit", overbooked: "heart", length_changed: "heart", booking_cancelled: "heart", hubspot_problem: "biscuit"
} as const;
/** Dog, client and trainer, from the chat or else the booking. */
const who = (i: IncidentRow) => ({
  dog: i.chat?.title || i.booking?.dog_name || "Dog",
  rest: [i.chat?.client_name || i.booking?.client_name, i.chat?.trainer_name || i.booking?.trainers?.name].filter(Boolean).join(", ")
});

export function IncidentList({ incidents, resolved }: { incidents: IncidentRow[]; resolved: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState<{ done: number; total: number; error?: string } | null>(null);

  const closable = incidents.filter((i) => i.kind === "ready_to_close" && i.status !== "resolved");
  const closeOne = (i: IncidentRow) => {
    if (!window.confirm(`Close the chat for ${i.chat?.title || "this dog"}?\n\nThe transcript is saved to Drive, the client is emailed a copy, and the messages are cleared from the app. The client can start a new chat any time.`)) return;
    start(async () => { const r = await closeChatAction(i.chat_id!); setMsg((m) => ({ ...m, [i.id]: r.message })); if (r.ok) router.refresh(); });
  };
  const closeAll = async () => {
    if (!window.confirm(`Close ${closable.length} chats? Each one is saved to Drive and emailed to its client first.`)) return;
    setBulk({ done: 0, total: closable.length });
    for (let n = 0; n < closable.length; n++) {
      const r = await closeChatAction(closable[n].chat_id!); // one at a time, so a slow Drive upload can't time out the batch
      if (!r.ok) { setBulk({ done: n, total: closable.length, error: `${closable[n].chat?.title || "A chat"}: ${r.message}` }); router.refresh(); return; }
      setBulk({ done: n + 1, total: closable.length });
    }
    router.refresh();
  };

  return (
    <div className="space-y-3">
      {!resolved && closable.length > 1 && (
        <div className="panel flex flex-wrap items-center justify-between gap-3 p-3.5">
          <p className="text-[14px]"><b>{closable.length} chats</b> have been quiet for 2 months and have no dog in care.</p>
          <button type="button" className="btn-ink h-10 min-h-0 px-3.5 text-[14px]" disabled={!!bulk && !bulk.error && bulk.done < bulk.total} onClick={closeAll}>{bulk && !bulk.error && bulk.done < bulk.total ? `Closing ${bulk.done + 1} of ${bulk.total}…` : `Close all ${closable.length}`}</button>
          {bulk?.error && <p role="alert" className="w-full text-[13px] text-heart">Stopped after {bulk.done}: {bulk.error}</p>}
        </div>
      )}
      <ul className="space-y-2.5">
        {incidents.map((i) => (
          <li key={i.id} className={`panel p-3.5 ${i.status === "taken" ? "" : resolved ? "" : "border-biscuit"}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold">{who(i).dog} <span className="font-normal text-ink-soft">{who(i).rest}</span></p>
                <p className="mt-0.5 text-[14px]">{i.detail}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1"><Pill tone={TONE[i.kind]}>{INCIDENT_LABEL[i.kind]}</Pill><span className="text-[12px] text-ink-faint">{timeAgo(i.opened_at)}</span></div>
            </div>
            {i.status === "taken" && <p className="mt-1.5 text-[13px] font-semibold text-fern">{i.taken_by} is on it</p>}
            {i.status === "resolved" && <p className="mt-1.5 text-[13px] text-ink-soft">Resolved {i.resolved_at ? timeAgo(i.resolved_at) : ""} by {i.resolved_by}{i.resolved_note ? `: ${i.resolved_note}` : ""}</p>}
            {msg[i.id] && <p role="status" className="mt-2 rounded-xl bg-paper px-3 py-2 text-[13px]">{msg[i.id]}</p>}
            {i.status !== "resolved" && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {i.chat_id && <Link href={`/a/chats/${i.chat_id}`} className="btn-ink h-9 min-h-0 px-3 text-[13px]">Open chat</Link>}
                {i.report_id && <Link href={`/a/reports/${i.report_id}`} className={`${i.chat_id ? "btn-ghost" : "btn-ink"} h-9 min-h-0 px-3 text-[13px]`}>Open report</Link>}
                {!i.report_id && i.booking?.trainer_id && <Link href={`/a/trainers/${i.booking.trainer_id}`} className={`${i.chat_id ? "btn-ghost" : "btn-ink"} h-9 min-h-0 px-3 text-[13px]`}>Open booking</Link>}
                {i.status === "open" && <button type="button" className="btn-ghost h-9 min-h-0 px-3 text-[13px]" disabled={pending} onClick={() => start(async () => { await takeIncidentAction(i.id); router.refresh(); })}>I&apos;ll take it</button>}
                {i.kind === "ready_to_close" && <button type="button" className="btn-ghost h-9 min-h-0 px-3 text-[13px]" disabled={pending} onClick={() => closeOne(i)}>{pending ? "Closing…" : "Close chat"}</button>}
                <button type="button" className="ml-auto text-[13px] font-semibold underline" onClick={() => setOpen(open === i.id ? null : i.id)}>Resolve</button>
              </div>
            )}
            {open === i.id && (
              <div className="mt-2 flex gap-2">
                <label className="sr-only" htmlFor={`note-${i.id}`}>Note (optional)</label>
                <input id={`note-${i.id}`} className="field flex-1 py-2" placeholder="What was done? (optional)" value={note[i.id] || ""} onChange={(e) => setNote((n) => ({ ...n, [i.id]: e.target.value }))} />
                <button type="button" className="btn-ink h-11 min-h-0 px-3.5 text-[14px]" disabled={pending} onClick={() => start(async () => { await resolveIncidentAction(i.id, note[i.id] || ""); setOpen(null); router.refresh(); })}>Done</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
