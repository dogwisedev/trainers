"use client";
import { useState, useTransition } from "react";
import { inviteClientAction } from "@/app/chat-actions";
import { ClientEmailsToggle } from "@/components/ChatActions";

/** Admin: set the client's email and send (or re-send) their chat link. */
export function InviteClient({ chatId, email, invitedAt, emailsOn }: { chatId: string; email: string | null; invitedAt: string | null; emailsOn: boolean }) {
  const [addr, setAddr] = useState(email || "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="panel p-4">
      <p className="text-[15px] font-bold">Client access</p>
      <p className="mt-0.5 text-[13px] text-ink-soft">{invitedAt ? `Chat link sent ${new Date(invitedAt).toLocaleDateString("en-US")}. Send it again if they lost it.` : "The client hasn't been sent their chat link yet."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="client-email">Client's email</label>
        <input id="client-email" type="email" inputMode="email" className="field min-w-[220px] flex-1" placeholder="client@example.com" value={addr} onChange={(e) => setAddr(e.target.value)} />
        <button type="button" className="btn-ink" disabled={pending || !addr.trim()}
          onClick={() => { if (!invitedAt || window.confirm(`Send the chat link to ${addr.trim()} again?`)) start(async () => { const r = await inviteClientAction(chatId, addr.trim()); setMsg({ ok: r.ok, text: r.message }); }); }}>
          {pending ? "Sending…" : invitedAt ? "Send link again" : "Invite client"}
        </button>
      </div>
      {msg && <p role="status" className={`mt-2 rounded-xl px-3 py-2 text-[14px] ${msg.ok ? "bg-mint-wash text-fern" : "bg-heart-wash text-heart"}`}>{msg.text}</p>}
      <ClientEmailsToggle chatId={chatId} on={emailsOn} />
    </div>
  );
}
