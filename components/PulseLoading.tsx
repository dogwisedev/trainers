"use client";
import { useEffect, useState } from "react";

// The loading card for Pulse: says what's being pulled, keeps a little company while it happens, and counts the seconds.
const SOURCES = ["bookings and dogs in care", "chat messages (up to 20,000)", "client-waiting and no-update alerts", "forms and their deadlines", "payslips", "closed deals", "HubSpot: deals created, won and lost"];
const LINES = ["Patience, Papi.", "Counting every dog twice, to be sure.", "Asking HubSpot nicely.", "Reading 20,000 chat messages so you don't have to.", "Working out who replied, and how fast.", "Nearly. Nearly.", "Still faster than 18 spreadsheets."];

export function PulseLoading() {
  const [sec, setSec] = useState(0);
  useEffect(() => { const t = setInterval(() => setSec((s) => s + 1), 1000); return () => clearInterval(t); }, []);
  const line = LINES[Math.min(LINES.length - 1, Math.floor(sec / 2.5))];
  const done = Math.min(SOURCES.length, Math.floor(sec / 1.2) + 1);
  return (
    <div className="panel mx-auto max-w-md p-5 text-center" role="status" aria-live="polite">
      <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-[3px] border-line border-t-lav" aria-hidden />
      <p className="text-lead font-extrabold">{line}</p>
      <p className="mt-1 text-small text-ink-soft">Pulling {SOURCES.length} sources · {sec}s</p>
      <ul className="mx-auto mt-4 max-w-xs space-y-1 text-left text-small">
        {SOURCES.map((s, i) => (
          <li key={s} className={`flex items-center gap-2 ${i < done ? "text-ink" : "text-ink-faint"}`}>
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${i < done ? "bg-lav" : "bg-line"}`} aria-hidden />{s}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-caption text-ink-faint">Live queries for now. Each range and view is kept for 5 minutes once it&apos;s loaded, so the next look is instant.</p>
    </div>
  );
}
