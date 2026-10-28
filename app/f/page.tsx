"use client";
import Image from "next/image";
import { useFormState, useFormStatus } from "react-dom";
import { requestFormLinkAction } from "@/app/form-actions";

function Send() { const { pending } = useFormStatus(); return <button className="btn-ink w-full" disabled={pending}>{pending ? "Sending…" : "Email me my link"}</button>; }

/** For an email whose personal link was missing: sends the link to the address Dogwise already has. Never makes a contact. */
export default function FormLinkRequest() {
  const [r, act] = useFormState(requestFormLinkAction, null);
  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-[max(20px,env(safe-area-inset-top))]">
      <div className="mb-6"><Image src="/brand-logo.png" alt="Dogwise Academy" width={132} height={41} priority /></div>
      <h1 className="text-h1 font-extrabold">Before training</h1>
      <p className="mt-1 text-body text-ink-soft">Type the email you gave Dogwise, and we&apos;ll send your personal link for your dog&apos;s questions.</p>
      <form action={act} className="mt-5 space-y-3">
        <label className="block"><span className="label">Email</span><input name="email" type="email" required autoComplete="email" inputMode="email" className="field" /></label>
        <Send />
      </form>
      {r && <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-small ${r.ok ? "bg-paper text-fern" : "bg-heart-wash text-heart"}`}>{r.message}</p>}
    </main>
  );
}
