"use client";
import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Eye, EyeOff } from "lucide-react";
import { signIn, signInWithCode, type SignInResult } from "@/app/actions";

function Go({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button className="btn-ink w-full" disabled={pending}>{pending ? "One moment…" : label}</button>;
}

export function LoginForm({ demo, trainers }: { demo: boolean; trainers: { id: string; name: string }[] }) {
  const [r, act] = useFormState(signIn, null);
  if (demo) {
    return (
      <form action={act} className="space-y-4">
        <p className="rounded-xl bg-biscuit-wash px-3 py-2 text-small text-warn">Demo mode: choose who to look around as.</p>
        <label className="block"><span className="label">View as</span>
          <select name="as" className="field" defaultValue="admin">
            <option value="admin">Admin (Dogwise team)</option>
            {trainers.map((t) => <option key={t.id} value={t.id}>{t.name} (trainer)</option>)}
          </select>
        </label>
        <Go label="Enter demo" />
      </form>
    );
  }
  return <RealForm r={r} act={act} />;
}

function RealForm({ r, act }: { r: SignInResult | null; act: (f: FormData) => void }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState("");
  const [codeFor, setCodeFor] = useState<string | null>(null);
  // Step 2 opens as soon as a code was sent (and stays open if the code was wrong)
  useEffect(() => { if (r?.codeFor) setCodeFor(r.codeFor); }, [r]);
  if (codeFor) return <CodeForm key={codeFor} email={codeFor} sent={r} back={() => setCodeFor(null)} resend={act} />;
  return (
    <form action={act} className="space-y-4">
      <label className="block"><span className="label">Email</span><input name="email" type="email" required autoComplete="email" inputMode="email" className="field" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <div>
        <label className="block"><span className="label">Password</span>
          <span className="relative block">
            <input name="password" type={show ? "text" : "password"} autoComplete="current-password" className="field pr-12" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button type="button" onClick={() => setShow((x) => !x)} className="absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-ink-faint hover:bg-paper" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </span>
        </label>
        <p className="mt-1.5 text-small text-ink-faint">No password, or forgotten it? Leave it empty and we&apos;ll email you a 6-digit code.</p>
      </div>
      <Go label={pw ? "Sign in" : "Email me a code"} />
      {r && !r.codeFor && <p role="status" className={`rounded-xl px-3 py-2 text-small ${r.ok ? "bg-paper text-fern" : "bg-heart-wash text-heart"}`}>{r.message}</p>}
    </form>
  );
}

function CodeForm({ email, sent, back, resend }: { email: string; sent: SignInResult | null; back: () => void; resend: (f: FormData) => void }) {
  const [r, act] = useFormState(signInWithCode, null);
  const [code, setCode] = useState("");
  return (
    <div className="space-y-4">
      <p className="text-body">We emailed a sign-in code to <b className="break-all">{email}</b>. Type it here.</p>
      {sent && !sent.ok && <p role="status" className="rounded-xl bg-heart-wash px-3 py-2 text-small text-heart">{sent.message}</p>}
      <form action={act} className="space-y-4">
        <input type="hidden" name="email" value={email} />
        <label className="block"><span className="label">6-digit code</span>
          <input name="code" required autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]*" maxLength={12} value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))} className="field text-center text-h2 font-bold tracking-[0.3em]" placeholder="••••••" />
        </label>
        <Go label="Sign in" />
      </form>
      {r && <p role="status" className={`rounded-xl px-3 py-2 text-small ${r.ok ? "bg-paper text-fern" : "bg-heart-wash text-heart"}`}>{r.message}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-small">
        <button type="button" onClick={back} className="font-semibold text-ink-soft underline">Use a different email</button>
        <form action={resend}><input type="hidden" name="email" value={email} /><ResendButton /></form>
      </div>
      <p className="text-caption text-ink-faint">Can&apos;t find it? Check spam or promotions. Only the newest code works.</p>
    </div>
  );
}

function ResendButton() {
  const { pending } = useFormStatus();
  return <button className="font-semibold text-ink underline" disabled={pending}>{pending ? "Sending…" : "Send a new code"}</button>;
}
