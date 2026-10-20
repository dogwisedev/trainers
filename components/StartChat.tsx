"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startChatAction } from "@/app/chat-actions";

/** On a booking row: open its chat, or start one. */
export function StartChat({ bookingId, chatId }: { bookingId: string; chatId?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  if (chatId) return <Link prefetch={false} href={`/a/chats/${chatId}`} className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-2.5 text-[13px] font-semibold">Open chat</Link>;
  return (
    <button type="button" disabled={pending} title={msg} className="h-9 rounded-lg border border-line bg-white px-2.5 text-[13px] font-semibold"
      onClick={() => start(async () => { const r = await startChatAction(bookingId); if (r.ok && r.chatId) router.push(`/a/chats/${r.chatId}`); else setMsg(r.message); })}>
      {pending ? "…" : msg ? "Retry chat" : "Start chat"}
    </button>
  );
}
