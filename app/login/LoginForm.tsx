"use client";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Eye, EyeOff } from "lucide-react";
import { signIn } from "@/app/actions";

function Go({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button className="btn-ink w-full" disabled={pending}>{pending ? "One moment…" : label}</button>;
}

export function LoginForm({ demo, trainers }: { demo: boolean; trainers: { id: string; name: string }[] }) {
  const [r, act] = useFormState(signIn, null);
  if (demo) {
    return (
      <form action={act} className="space-y-4">
        <p className="rounded-xl bg-biscuit-wash px-3 py-2 text-[13px] text-[#8A5A00]">Demo mode: choose who to look around as.</p>
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

function RealForm({ r, act }: { r: { ok: boolean; message: string } | null; act: (f: FormData) => void }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  return (
    <form action={act} className="space-y-4">
      <label className="block"><span className="label">Email</span><input name="email" type="email" required autoComplete="email" inputMode="email" className="field" placeholder="you@example.com" /></label>
      <div>
        <label className="block"><span className="label">Password</span>
          <span className="relative block">
            <input name="password" type={show ? "text" : "password"} autoComplete="current-password" className="field pr-12" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button type="button" onClick={() => setShow((x) => !x)} className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-ink-faint hover:bg-paper" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </span>
        </label>
        <p className="mt-1.5 text-[12.5px] text-ink-faint">No password, or forgotten it? Leave it empty and we&apos;ll email you a sign-in link.</p>
      </div>
      <Go label={pw ? "Sign in" : "Email me a sign-in link"} />
      {r && <p role="status" className={`rounded-xl px-3 py-2 text-[14px] ${r.ok ? "bg-paper text-fern" : "bg-heart-wash text-heart"}`}>{r.message}</p>}
    </form>
  );
}
