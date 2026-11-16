"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { clientCloseAction } from "@/app/nudge-actions";
import { WhyPick } from "@/components/WhyPick";

const WHY = { noreply: ["Just thanks or OK", "Answered by phone", "Answered by email or text", "Not a question", "Other"], handled: ["Answered by phone", "Answered by email or text", "Sean decided", "Not needed", "Other"] };
/** "No reply needed" on a waiting client, "Handled" on an office question or urgent message: one tap on why, then it closes. */
export function ClientClose({ id, mode }: { id: string; mode: "noreply" | "handled" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = (why: string) => start(async () => { const r = await clientCloseAction(id, why); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); });
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" disabled={pending || msg?.ok} onClick={() => setOpen((o) => !o)} className="btn-ghost h-9 min-h-0 px-3 text-small"><Check size={15} />{pending ? "Saving…" : mode === "noreply" ? "No reply needed" : "Handled"}</button>
      {open && !pending && !msg?.ok && <WhyPick reasons={WHY[mode]} value="" onPick={go} label={mode === "noreply" ? "Why no reply?" : "Handled how?"} />}
      {msg && !msg.ok && <span role="status" className="mt-1 text-small font-semibold text-heart">{msg.text}</span>}
    </span>
  );
}
