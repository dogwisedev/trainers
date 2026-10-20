"use client";
import { useEffect, useState } from "react";
import { Bell, BellOff, Download, MoreVertical, Share, SquarePlus, X } from "lucide-react";

// Gets people onto the app and its notifications, with plain steps for their phone.
//  Step 1, install: Android = one-tap Install button (or the ⋮ menu steps); iPhone = Share → Add to Home Screen (Apple allows nothing more).
//  Step 2, notifications: once installed (iPhone) or right away (Android, computers).
// "Not now" hides it for 3 days. On the account/profile page (`always`) it stays, as the place to turn things on later.
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const KEY = "dogwise-setup-hidden-until";
const b64 = (s: string) => { const p = "=".repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };

export function AppSetup({ always = false }: { always?: boolean }) {
  const [env, setEnv] = useState<{ ios: boolean; android: boolean; mobile: boolean; standalone: boolean; push: boolean } | null>(null);
  const [bip, setBip] = useState<BIP | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [subscribed, setSubscribed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const ua = navigator.userAgent, ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const android = /android/i.test(ua), standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    const push = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setEnv({ ios, android, mobile: ios || android, standalone, push });
    setPerm(push ? Notification.permission : "unsupported");
    try { setHidden(!always && Number(localStorage.getItem(KEY) || 0) > Date.now()); } catch { /* private mode */ }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then(async (reg) => setSubscribed(!!(await reg.pushManager?.getSubscription?.()))).catch(() => {});
    const onBip = (e: Event) => { e.preventDefault(); setBip(e as BIP); };
    const onInstalled = () => setEnv((x) => (x ? { ...x, standalone: true } : x));
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onBip); window.removeEventListener("appinstalled", onInstalled); };
  }, [always]);

  if (!env) return null;
  const needInstall = env.mobile && !env.standalone;
  const canPush = env.push && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !(env.ios && !env.standalone);
  const needPush = canPush && !(perm === "granted" && subscribed);
  if (!always && (hidden || (!needInstall && !needPush))) return null;

  const hide = () => { try { localStorage.setItem(KEY, String(Date.now() + 3 * 86400e3)); } catch { /* ignore */ } setHidden(true); };
  const install = async () => { if (!bip) return; await bip.prompt(); const c = await bip.userChoice; if (c.outcome === "accepted") setBip(null); };
  const turnOn = async () => {
    setBusy(true); setMsg("");
    try {
      const p = await Notification.requestPermission(); setPerm(p);
      if (p !== "granted") { setMsg("Notifications weren't allowed. See below to turn them on."); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) });
      const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!r.ok) throw new Error("Couldn't save it. Try again.");
      setSubscribed(true);
      await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: true }) });
      setMsg("Done! You should see a test notification now.");
    } catch (e) { setMsg((e as Error).message || "Something went wrong. Try again."); } finally { setBusy(false); }
  };
  const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-[13px] font-bold text-white">{n}</span><span className="pt-0.5 text-[15px] leading-snug">{children}</span></li>
  );
  const Key = ({ children }: { children: React.ReactNode }) => <span className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-line bg-white px-1.5 py-0.5 align-middle text-[13px] font-semibold">{children}</span>;

  return (
    <section className="panel relative mb-5 border-lav/40 p-4 md:p-5" aria-labelledby="setup-title">
      {!always && <button type="button" onClick={hide} className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full text-ink-faint hover:bg-paper" aria-label="Not now"><X size={18} /></button>}
      {needInstall ? (
        <>
          <h2 id="setup-title" className="pr-8 text-[19px] font-extrabold">Get the Dogwise app on your phone</h2>
          <p className="mt-1 text-[14px] text-ink-soft">It takes 30 seconds, once. Then open Dogwise from its icon, like any app{env.ios ? ", and you can turn on notifications" : ""}.</p>
          {env.ios ? (
            <ol className="mt-4 space-y-3">
              <Step n={1}>Tap the <Key><Share size={14} />Share</Key> button: at the bottom of the screen in Safari, or the top right in Chrome.</Step>
              <Step n={2}>Scroll down and tap <Key><SquarePlus size={14} />Add to Home Screen</Key>.</Step>
              <Step n={3}>Tap <Key>Add</Key>, then open <b>Dogwise</b> from your Home Screen and sign in with your email and <b>password</b> (no password yet? Set one under the key icon first).</Step>
            </ol>
          ) : bip ? (
            <button type="button" onClick={install} className="btn-ink mt-4 w-full sm:w-auto"><Download size={18} />Install the app</button>
          ) : (
            <ol className="mt-4 space-y-3">
              <Step n={1}>Tap the <Key><MoreVertical size={14} />menu</Key> at the top right of Chrome.</Step>
              <Step n={2}>Tap <Key>Install app</Key> or <Key>Add to Home screen</Key>, then <Key>Install</Key>.</Step>
              <Step n={3}>Open <b>Dogwise</b> from your home screen.</Step>
            </ol>
          )}
        </>
      ) : needPush || always ? (
        <>
          <h2 id="setup-title" className="pr-8 text-[19px] font-extrabold">{perm === "granted" && subscribed ? "Notifications are on" : "Turn on notifications"}</h2>
          <p className="mt-1 text-[14px] text-ink-soft">{perm === "granted" && subscribed ? "You'll get new messages, bookings and forms on this phone straight away." : "So you see new messages, bookings and forms straight away, not just by email."}</p>
          {!canPush ? (
            <p className="mt-3 text-[14px] font-semibold">{env.ios ? "Add the app to your Home Screen first (Share, then Add to Home Screen), and open it from there." : "This browser can't show notifications. Try Chrome."}</p>
          ) : perm === "denied" ? (
            <div className="mt-3 rounded-xl bg-biscuit-wash p-3 text-[14px]"><p className="flex items-center gap-2 font-bold"><BellOff size={16} />Notifications are blocked on this phone</p>
              <p className="mt-1">{env.ios ? "Open Settings, tap Notifications, find Dogwise and turn on Allow Notifications." : "In Chrome, tap the icon to the left of the web address, then Permissions, and allow Notifications. In the installed app: long-press its icon, App info, Notifications."}</p></div>
          ) : !(perm === "granted" && subscribed) ? (
            <button type="button" onClick={turnOn} disabled={busy} className="btn-ink mt-4 w-full sm:w-auto"><Bell size={18} />{busy ? "Turning on…" : "Turn on notifications"}</button>
          ) : (
            <button type="button" onClick={() => fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: true }) }).then(() => setMsg("Test sent."))} className="btn-ghost mt-3">Send a test notification</button>
          )}
          {needPush && !always && <p className="mt-2 text-[12px] text-ink-faint">Your phone will ask: tap Allow.</p>}
        </>
      ) : null}
      {msg && <p role="status" className="mt-3 text-[14px] font-semibold">{msg}</p>}
    </section>
  );
}
