"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { resendInvitesAction } from "@/app/chat-actions";

/** Admin: send the welcome email (sign-in button + password) again to the clients who haven't opened their chat. */
export function ResendInvites({ chatIds }: { chatIds: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  if (!chatIds.length) return null;
  return (
    <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3.5">
      <p className="min-w-0 flex-1 text-[14px]"><b>{chatIds.length} client{chatIds.length > 1 ? "s haven't" : " hasn't"} opened their chat.</b> Send them the welcome email again, with the sign-in button and their password.</p>
      <button type="button" className="btn-ink h-9 min-h-0 px-3 text-[13px]" disabled={pending}
        onClick={() => { if (window.confirm(`Send the welcome email again to ${chatIds.length} client${chatIds.length > 1 ? "s" : ""}?`)) start(async () => { const r = await resendInvitesAction(chatIds); setMsg(r.message); router.refresh(); }); }}>
        <Mail size={15} />{pending ? "Sending…" : "Send again"}
      </button>
      {msg && <p role="status" className="w-full text-[13px] font-semibold">{msg}</p>}
    </div>
  );
}
