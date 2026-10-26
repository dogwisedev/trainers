"use client";
import { useEffect } from "react";
import { RotateCw } from "lucide-react";

/** "Something went wrong": says so plainly, offers Try again, and logs it (who, which screen, why) for the activity log. */
export function ErrorScreen({ error, reset, home = "/" }: { error: Error & { digest?: string }; reset: () => void; home?: string }) {
  useEffect(() => {
    try {
      fetch("/api/log/error", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: location.pathname, message: error.message, digest: error.digest, device: navigator.userAgent.replace(/^Mozilla\/5\.0 \(([^)]*)\).*/, "$1") }) }).catch(() => {});
    } catch { /* never in the way */ }
  }, [error]);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <div role="alert" className="mx-auto max-w-md rounded-[24px] border border-line bg-white p-6 text-center shadow-card">
      <p className="text-h3 font-extrabold">{offline ? "You're offline" : "This screen didn't load"}</p>
      <p className="mt-2 text-body text-ink-soft">{offline ? "Check your signal, then try again." : "It's been reported to the Dogwise team. Try again: it usually works the second time."}</p>
      <div className="mt-5 grid gap-2">
        <button type="button" onClick={() => reset()} className="btn-ink w-full"><RotateCw size={16} />Try again</button>
        <a href={home} className="btn-ghost w-full">Go to the home screen</a>
      </div>
      {error.digest && <p className="mt-4 text-caption text-ink-faint">Reference: {error.digest}</p>}
    </div>
  );
}
