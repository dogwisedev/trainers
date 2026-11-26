"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BellOff, Bell } from "lucide-react";
import { quietChatAction } from "@/app/chat-actions";

/** Quiet chat / Alerts back on. Only rendered for the people allowed to use it (the server checks again). */
export function QuietChatButton({ chatId, quiet, small = false }: { chatId: string; quiet: boolean; small?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const go = () => {
    if (!quiet && !window.confirm("Quiet this chat? The team won’t get “hasn’t posted” or “client waiting” alerts for it, and the client won’t get update emails, until it’s switched back on.")) return;
    start(async () => { const r = await quietChatAction(chatId, !quiet); setMsg(r.ok ? "" : r.message); router.refresh(); });
  };
  return (
    <span className="inline-flex flex-col items-start">
      {small ? <button type="button" onClick={go} disabled={pending} className="font-semibold text-ink-soft underline">{pending ? "Saving…" : quiet ? "Alerts back on" : "Quiet chat (stop reminders)"}</button> :
      <button type="button" onClick={go} disabled={pending} title={quiet ? "Reminders and To do items for this chat start again" : "Stops reminders, To do items and client update emails for this chat until it's switched back on"} className={`btn-ghost min-h-0 ${small ? "h-9 px-3 text-small" : "h-9 px-3 text-small"}`}>
        {quiet ? <Bell size={15} /> : <BellOff size={15} />}{pending ? "Saving…" : quiet ? "Alerts back on" : "Quiet chat"}
      </button>}
      {!quiet && !small && <span className="mt-0.5 max-w-[16rem] text-caption text-ink-faint">Press to stop reminders and To do for this chat (for dogs finishing on Signal).</span>}
      {msg && <span role="alert" className="mt-1 text-caption text-heart">{msg}</span>}
    </span>
  );
}
