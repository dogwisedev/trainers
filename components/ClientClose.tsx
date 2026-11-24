"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { clientCloseAction } from "@/app/nudge-actions";
import { WhyPick } from "@/components/WhyPick";

const WHY = { noreply: ["Just thanks or OK", "Answered by phone", "Answered by email or text", "Trainer says they answered outside the app", "Not a question", "Other"], handled: ["Handled in the chat", "Answered by phone", "Answered by email or text", "Sean decided", "Not needed", "Other"] };
/** "No reply needed" on a waiting client, "Handled" on an office question or urgent message: one tap on why, then it closes. */
export function ClientClose({ id, mode, quick }: { id: string; mode: "noreply" | "handled"; quick?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = (why: string) => start(async () => { const r = await clientCloseAction(id, why); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); });
  return (
    <span className="inline-flex flex-col items-start">
      <span className="inline-flex flex-wrap gap-2">
        {/* The trainer has replied in the chat: one tap to confirm it's handled there */}
        {quick && !msg?.ok && <button type="button" disabled={pending} onClick={() => go(quick)} className="btn-ink h-9 min-h-0 px-3 text-small"><Check size={15} />{pending ? "Saving…" : quick}</button>}
        <button type="button" disabled={pending || msg?.ok} onClick={() => setOpen((o) => !o)} className="btn-ghost h-9 min-h-0 px-3 text-small"><Check size={15} />{pending ? "Saving…" : mode === "noreply" ? "No reply needed" : quick ? "Handled another way" : "Handled"}</button>
      </span>
      {open && !pending && !msg?.ok && <WhyPick reasons={WHY[mode]} value="" onPick={go} label={mode === "noreply" ? "Why no reply?" : "Handled how?"} />}
      {msg && !msg.ok && <span role="status" className="mt-1 text-small font-semibold text-heart">{msg.text}</span>}
    </span>
  );
}
