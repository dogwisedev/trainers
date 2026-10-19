"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFollowupsAction } from "@/app/actions";

/** Up to 3 follow-up session dates, saved on the HubSpot deal. Each one is paid in the pay period of its date. */
export function FollowupDates({ bookingId, dates, rate }: { bookingId: string; dates: string[]; rate?: number }) {
  const router = useRouter();
  const [v, setV] = useState([dates[0] || "", dates[1] || "", dates[2] || ""]);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        {v.map((d, i) => (
          <label key={i} className="block"><span className="label">Session {i + 1}</span>
            <input type="date" className="field" value={d} onChange={(e) => setV((x) => x.map((y, j) => (j === i ? e.target.value : y)))} /></label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ink" disabled={pending} onClick={() => start(async () => { const r = await setFollowupsAction(bookingId, v); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); })}>{pending ? "Saving…" : "Save dates"}</button>
        {rate !== undefined && <span className="text-[13px] text-ink-soft">Trainer is paid ${rate} per session.</span>}
      </div>
      {msg && <p role="status" className={`mt-2 text-[13px] font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </div>
  );
}
