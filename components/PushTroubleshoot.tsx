"use client";
import { useState } from "react";

/** Step-by-step notification test for one phone: shows where the chain stops. */
export function PushTroubleshoot() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const say = (m: string) => setLog((l) => [...l, m]);
  const b64 = (s: string) => { const p = "=".repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  const reg = async () => (await navigator.serviceWorker.getRegistration("/")) || null;

  const status = async () => {
    setLog([]);
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return say("❌ This browser doesn't support notifications.");
    say(`Browser: ${navigator.userAgent.match(/(Chrome|CriOS|Firefox|Safari|Edg|SamsungBrowser)\/[\d.]+/)?.[0] || "unknown"}${"brave" in navigator ? " (Brave)" : ""}`);
    say(`Opened as installed app: ${window.matchMedia("(display-mode: standalone)").matches ? "yes" : "no"}`);
    say(`Permission: ${Notification.permission}`);
    const r = await reg();
    say(`Service worker: ${r?.active ? `running (${r.active.scriptURL.split("/").pop()})` : r ? "registered, not running yet" : "❌ not registered"}`);
    const sub = r ? await r.pushManager.getSubscription() : null;
    say(`This phone's sign-up: ${sub ? `yes (${new URL(sub.endpoint).host})` : "❌ none"}`);
    return { r, sub };
  };
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { say(`❌ ${(e as Error).message}`); } finally { setBusy(false); } };

  const local = () => run(async () => {
    const r = await reg();
    if (!r?.active) return say("❌ Service worker isn't running. Close the app fully and reopen it.");
    if (Notification.permission !== "granted") return say("❌ Permission isn't granted, so the phone can't show anything.");
    await r.showNotification("Local test", { body: "Shown by this phone itself, no internet involved.", icon: "/icons/icon-192.png", tag: "local" });
    say("✅ Asked the phone to show a notification. Did it appear? If not, the phone (Android settings) is hiding them.");
  });
  const server = () => run(async () => {
    const sub = (await (await reg())?.pushManager.getSubscription()) || null;
    const res = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ diagnose: true, endpoint: sub?.endpoint }) });
    const d = await res.json();
    say(`Server keys: public ${d.serverKey ? `${d.serverKey}…` : "❌ missing"}, private ${d.privateKeySet ? "set" : "❌ missing"}`);
    if (!d.results?.length) return say("❌ The server has no sign-up for you. Use Reset below.");
    for (const x of d.results) say(`${x.thisDevice ? "This phone" : "Other device"}: ${x.error ? `❌ ${x.status ?? ""} ${x.error}` : `✅ push service accepted it (${x.status}). It should appear within seconds.`}`);
    if (sub && !d.results.some((x: { thisDevice: boolean }) => x.thisDevice)) say("❌ This phone's sign-up isn't on the server. Use Reset below.");
  });
  const reset = () => run(async () => {
    const r = await reg();
    if (!r) return say("❌ No service worker. Close the app fully and reopen it.");
    const old = await r.pushManager.getSubscription();
    if (old) { await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: old.endpoint }) }); await old.unsubscribe(); say("Removed the old sign-up."); }
    const sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) });
    const res = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    say(res.ok ? "✅ Fresh sign-up saved. Now tap 'Send one from the server'." : "❌ Couldn't save the new sign-up.");
  });

  return (
    <details className="panel mt-4 p-4" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !log.length) status(); }}>
      <summary className="cursor-pointer font-bold">Notifications not arriving? Troubleshoot</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-ghost h-9 min-h-0 px-3 text-small" disabled={busy} onClick={() => run(async () => { await status(); })}>Check status</button>
        <button type="button" className="btn-ghost h-9 min-h-0 px-3 text-small" disabled={busy} onClick={local}>1. Show a notification here</button>
        <button type="button" className="btn-ghost h-9 min-h-0 px-3 text-small" disabled={busy} onClick={server}>2. Send one from the server</button>
        <button type="button" className="btn-ghost h-9 min-h-0 px-3 text-small" disabled={busy} onClick={reset}>3. Reset notifications on this phone</button>
      </div>
      {log.length > 0 && <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-paper p-3 text-caption leading-relaxed text-ink">{log.join("\n")}</pre>}
    </details>
  );
}
