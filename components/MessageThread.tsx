"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { SendHorizontal } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { markRead, sendMessage } from "@/app/actions";
import { Message, Role } from "@/lib/types";
import { timeAgo } from "@/lib/dates";

export function MessageThread({ trainerId, initial, me, otherName }: { trainerId: string; initial: Message[]; me: Role; otherName: string }) {
  const [msgs, setMsgs] = useState(initial);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  useEffect(() => { markRead(trainerId); }, [trainerId]);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    const sb = createBrowserClient(url, key);
    const ch = sb.channel(`thread-${trainerId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `trainer_id=eq.${trainerId}` }, (p) => {
        const m = p.new as Message;
        setMsgs((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur.filter((x) => !(x.id.startsWith("local-") && x.body === m.body)), m]));
        if (m.sender_role !== me) markRead(trainerId);
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [trainerId, me]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setErr("");
    const local: Message = { id: `local-${Date.now()}`, trainer_id: trainerId, sender_role: me, sender_name: null, body, created_at: new Date().toISOString(), read_at: null };
    setMsgs((m) => [...m, local]);
    setText("");
    start(async () => {
      const r = await sendMessage(trainerId, body);
      if (!r.ok) { setErr(r.message); setMsgs((m) => m.filter((x) => x.id !== local.id)); setText(body); }
    });
  };

  return (
    <div className="flex min-h-[60dvh] flex-col">
      <div className="flex-1 space-y-2.5">
        {msgs.length === 0 && <p className="py-10 text-center text-[14px] text-ink-faint">No messages yet. Say hello to {otherName}.</p>}
        {msgs.map((m) => {
          const mine = m.sender_role === me;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[82%] rounded-[20px] px-4 py-2.5 text-[15px] leading-snug ${mine ? "rounded-br-md bg-ink text-white" : "rounded-bl-md border border-line bg-white"}`}>
                {!mine && m.sender_name && <p className="mb-0.5 text-[12px] font-semibold text-fern">{m.sender_name}</p>}
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className={`mt-1 text-[11px] ${mine ? "text-white/60" : "text-ink-faint"}`}>{m.id.startsWith("local-") ? "Sending" : timeAgo(m.created_at)}{mine && m.read_at ? ", seen" : ""}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {err && <p className="mt-3 text-[13px] text-heart">{err}</p>}
      <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] mt-4 flex items-end gap-2 rounded-[22px] border border-line bg-white p-2 md:bottom-4">
        <label className="sr-only" htmlFor="msg">Message</label>
        <textarea id="msg" rows={1} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={`Message ${otherName}`} className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] focus:outline-none" />
        <button onClick={send} disabled={pending || !text.trim()} className="btn-ink h-11 w-11 shrink-0 rounded-full p-0" aria-label="Send"><SendHorizontal size={18} /></button>
      </div>
    </div>
  );
}
