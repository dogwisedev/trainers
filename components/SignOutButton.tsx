"use client";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions";

function Confirm() {
  const { pending } = useFormStatus();
  return <button className="btn-ink w-full" disabled={pending}>{pending ? "Signing out…" : "Sign out"}</button>;
}

/** Sign out, with a "Are you sure?" step so a stray tap doesn't log someone out of the app. */
export function SignOutButton({ variant = "text", className = "" }: { variant?: "icon" | "text"; className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);
  return (
    <>
      {variant === "icon"
        ? <button type="button" onClick={() => setOpen(true)} className={`grid h-11 w-11 place-items-center rounded-full text-ink-soft hover:bg-paper ${className}`} aria-label="Sign out"><LogOut size={18} /></button>
        : <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-2 hover:text-ink ${className}`}><LogOut size={15} />Sign out</button>}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="signout-title" className="w-full max-w-sm rounded-[24px] bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-lift" onClick={(e) => e.stopPropagation()}>
            <p id="signout-title" className="text-h3 font-extrabold">Sign out?</p>
            <p className="mt-1 text-body text-ink-soft">You&apos;ll need your password or an emailed code to get back in.</p>
            <form action={signOut} className="mt-5 space-y-2">
              <Confirm />
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost w-full">Stay signed in</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
