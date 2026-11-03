"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setFollowupTrainerAction } from "@/app/actions";

/** Dog page, Follow-up sessions: who does them. Another trainer joins the chat, books and logs them, and is paid for them. */
export function FollowupTrainer({ bookingId, programTrainer, current, trainers }: { bookingId: string; programTrainer: string; current: string; trainers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [v, setV] = useState(current), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mb-3 rounded-xl bg-paper/60 p-3">
      <label className="block"><span className="label">Who does the follow-ups?</span>
        <div className="mt-1 flex flex-wrap gap-2">
          <select value={v} onChange={(e) => setV(e.target.value)} className="field h-10 w-auto min-w-[14rem]">
            <option value="">{programTrainer} (the program trainer)</option>
            {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button type="button" disabled={pending || v === current} onClick={() => start(async () => { const r = await setFollowupTrainerAction(bookingId, v); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); })} className="btn-ink h-10 min-h-0 px-4">{pending ? "Saving…" : "Save"}</button>
        </div>
      </label>
      <p className="mt-1 text-caption text-ink-faint">Another trainer joins the dog&apos;s chat (the program trainer stays in it), books and logs the follow-ups, and is paid for them. The program&apos;s own pay doesn&apos;t change.</p>
      {msg && <p role="status" className={`mt-1 text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </div>
  );
}
