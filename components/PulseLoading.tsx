"use client";
import { useEffect, useState } from "react";

// The loading card for Pulse: says what's being pulled, keeps a little company while it happens, and counts the seconds.
const STEPS = ["Bookings and dogs in care", "Every chat message, 90 days", "Forms, alerts, time off", "HubSpot: leads, sales, last year", "Stripe", "Working it out"];
const LINES = ["Patience, Papi.", "Counting every dog twice, to be sure.", "Asking HubSpot nicely.", "Working out who replied, and how fast.", "Nearly. Nearly.", "Still faster than 18 spreadsheets."];

export function PulseLoading({ instant = false }: { instant?: boolean }) {
  const [sec, setSec] = useState(0);
  useEffect(() => { const t = setInterval(() => setSec((s) => s + 1), 1000); return () => clearInterval(t); }, []);
  const line = LINES[Math.min(LINES.length - 1, Math.floor(sec / 2.5))];
  const done = Math.min(STEPS.length, Math.floor(sec / 1.5) + 1);
  // Appears only after 0.4 s: a cached load (well under that) never flashes it
  return (
    <div className={`panel mx-auto max-w-md p-5 text-center ${instant ? "" : "opacity-0 [animation:fade-in_.25s_.4s_ease-out_forwards]"}`} role="status" aria-live="polite">
      <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-[3px] border-line border-t-lav" aria-hidden />
      <p className="text-lead font-extrabold">{line}</p>
      <p className="mt-1 text-small text-ink-soft">On it · {sec}s</p>
      <ul className="mx-auto mt-4 max-w-xs space-y-1 text-left text-small">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex items-center gap-2 ${i < done ? "text-ink" : "text-ink-faint"}`}>
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${i < done ? "bg-lav" : "bg-line"}`} aria-hidden />{s}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-caption text-ink-faint">Taking a 90-day snapshot. Once it&apos;s taken, every range and view is instant for an hour; Refresh takes a new one.</p>
    </div>
  );
}
