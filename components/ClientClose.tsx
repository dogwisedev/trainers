"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { clientCloseAction } from "@/app/nudge-actions";

/** "No reply needed" on a waiting client, "Handled" on an office question or urgent message. Counts as the answer. */
export function ClientClose({ id, mode }: { id: string; mode: "noreply" | "handled" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending || msg?.ok} onClick={() => start(async () => { const r = await clientCloseAction(id); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); })}
        className="btn-ghost h-9 min-h-0 px-3 text-small"><Check size={15} />{pending ? "Saving…" : mode === "noreply" ? "No reply needed" : "Handled"}</button>
      {msg && !msg.ok && <span role="status" className="text-small font-semibold text-heart">{msg.text}</span>}
    </span>
  );
}
