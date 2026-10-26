"use client";
// Last resort, if even the app's frame fails to load. Plain on purpose: the normal styles may be what failed.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#F8F6FD", color: "#281870", padding: "64px 20px", textAlign: "center" }}>
        <p style={{ fontSize: 22, fontWeight: 800 }}>The Dogwise app didn&apos;t load</p>
        <p style={{ fontSize: 15, color: "#5D5880" }}>Check your signal and try again.</p>
        <button onClick={() => reset()} style={{ marginTop: 16, background: "#281870", color: "#fff", border: 0, borderRadius: 12, padding: "12px 22px", fontSize: 15, fontWeight: 700 }}>Try again</button>
      </body>
    </html>
  );
}
