"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { sendSigninHellos } from "@/app/actions";

type Row = { id: string; name: string; email: string | null; hasLogin: boolean; nudgedAt: string | null };
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Admin: trainers who haven't signed in yet, with a friendly "here's how to get in" email (one or all). */
export function SigninHello({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = (ids: string[], confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => { const r = await sendSigninHellos(ids); setMsg({ ok: r.ok, text: r.message }); router.refresh(); });
  };
  const sendable = rows.filter((r) => r.email);
  return (
    <details id="signin" className="panel mb-4 scroll-mt-20 p-4">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <span><span className="font-bold">{rows.length} trainer{rows.length === 1 ? " hasn't" : "s haven't"} signed in yet</span> <span className="text-small text-ink-soft">tap to see who</span></span>
        {sendable.length > 0 && (
          <button type="button" className="btn-ink h-9 min-h-0 px-3 text-small" disabled={pending}
            onClick={(e) => { e.preventDefault(); send(sendable.map((r) => r.id), `Send the friendly sign-in email to ${sendable.length} trainer${sendable.length === 1 ? "" : "s"}?`); }}>
            <Mail size={15} />{pending ? "Sending…" : "Email them all"}
          </button>
        )}
      </summary>
      {msg && <p role="status" className={`mt-3 text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
      <p className="mt-3 text-small text-ink-soft">The email explains what the app is for, has a button that signs them straight in (works for 7 days), and asks them to set a password and add it to their home screen.</p>
      <ul className="mt-3 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span><span className="font-semibold">{r.name}</span> <span className="text-small text-ink-soft">{!r.email ? "no email on profile" : r.nudgedAt ? `emailed ${when(r.nudgedAt)}` : r.hasLogin ? "login sent, never opened" : "no login yet"}</span></span>
            {r.email && <button type="button" className="btn-ghost h-8 min-h-0 px-2.5 text-small" disabled={pending} onClick={() => send([r.id])}>{r.nudgedAt ? "Send again" : "Send"}</button>}
          </li>
        ))}
      </ul>
    </details>
  );
}
