"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeChatAction, reopenChatAction, sendSummaryAgainAction, setClientEmailsAction } from "@/app/chat-actions";

/** Admin: close this chat (saves a transcript to Drive, emails the client, clears the messages). */
export function CloseChat({ chatId, title, after }: { chatId: string; title: string; after?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  // Training not over yet: no button, just when it can be closed
  if (after) return <p className="text-caption text-ink-faint">Can be closed after training ({after}).</p>;
  return (
    <div>
      <button type="button" disabled={pending} className="btn-ghost h-9 min-h-0 px-3 text-small"
        onClick={() => { if (window.confirm(`Close the chat for ${title}?\n\nThe transcript is saved to Drive, the client is emailed a copy with a link to all photos and videos, and the messages are cleared from the app. The client can start a new chat any time.`)) start(async () => { const r = await closeChatAction(chatId); setMsg(r.message); if (r.ok) router.refresh(); }); }}>
        {pending ? "Closing…" : "Close chat"}
      </button>
      {msg && <p role="status" className="mt-1 text-caption text-ink-soft">{msg}</p>}
    </div>
  );
}

/** Start a fresh chat after the old one was closed. `base` is where the new chat lives for this person. */
export function ReopenChat({ chatId, base, label = "Start a new chat" }: { chatId: string; base: "/a/chats" | "/c"; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <div>
      <button type="button" disabled={pending} className="btn-ink" onClick={() => start(async () => { const r = await reopenChatAction(chatId); if (r.ok && r.chatId) router.push(`${base}/${r.chatId}`); else setMsg(r.message); })}>{pending ? "Starting…" : label}</button>
      {msg && <p role="alert" className="mt-2 text-small text-heart">{msg}</p>}
    </div>
  );
}

export function SendSummaryAgain({ chatId }: { chatId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <div>
      <button type="button" disabled={pending} className="btn-ghost" onClick={() => start(async () => setMsg((await sendSummaryAgainAction(chatId)).message))}>{pending ? "Sending…" : "Send summary again"}</button>
      {msg && <p role="status" className="mt-2 text-small text-ink-soft">{msg}</p>}
    </div>
  );
}

/** Admin: should this client get the (at most daily) "new updates" email? */
export function ClientEmailsToggle({ chatId, on }: { chatId: string; on: boolean }) {
  const [value, setValue] = useState(on);
  const [pending, start] = useTransition();
  return (
    <label className="mt-3 flex cursor-pointer items-start gap-3 text-body">
      <input type="checkbox" className="mt-1 h-5 w-5 accent-[#281870]" checked={value} disabled={pending} onChange={(e) => { const v = e.target.checked; setValue(v); start(async () => { const r = await setClientEmailsAction(chatId, v); if (!r.ok) setValue(!v); }); }} />
      <span><b>Email this client about new updates</b><br /><span className="text-small text-ink-soft">At most one email a day, only if something is still unread, never at night. Clients can also switch it off from the email.</span></span>
    </label>
  );
}
