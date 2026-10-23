"use client";
import { useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { sendHandoverTestAction } from "@/app/report-actions";

/** Admin: email yourself the handover report + certificate exactly as the client gets them. Nothing else happens. */
export function HandoverTestEmail({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <>
      <button type="button" className="btn-ghost h-9 min-h-0 px-3 text-[13px]" disabled={pending}
        onClick={() => start(async () => { const r = await sendHandoverTestAction(id); setMsg({ ok: r.ok, text: r.message }); })}>
        <Mail size={14} />{pending ? "Sending…" : "Email me a test copy"}
      </button>
      {msg && <p role="status" className={`w-full text-[13px] font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </>
  );
}
