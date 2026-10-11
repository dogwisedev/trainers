"use client";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

// Some Supabase links put the session after a "#" (e.g. invites sent with the default template).
// The server never sees that part, so finish the sign-in here in the browser.
export function HashSignIn() {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const access_token = h.get("access_token"), refresh_token = h.get("refresh_token");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (h.get("error_description")) { window.location.replace(`/login?error=link&detail=${encodeURIComponent(h.get("error_description")!)}`); return; }
    if (!access_token || !refresh_token || !url || !key) return;
    setBusy(true);
    createBrowserClient(url, key).auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      window.location.replace(error ? `/login?error=link&detail=${encodeURIComponent(error.message)}` : h.get("type") === "invite" ? "/t/profile" : "/");
    });
  }, []);
  return busy ? <p className="mt-6 rounded-xl bg-white/80 px-4 py-3 text-[14px]">Signing you in…</p> : null;
}
