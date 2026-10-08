"use client";
import { useFormState, useFormStatus } from "react-dom";
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
  return (
    <form action={act} className="space-y-4">
      <label className="block"><span className="label">Email</span><input name="email" type="email" required autoComplete="email" className="field" /></label>
      <label className="block"><span className="label">Password</span><input name="password" type="password" autoComplete="current-password" className="field" placeholder="Leave empty to get an email link" /></label>
      <Go label="Sign in" />
      {r && <p role="status" className={`text-[14px] ${r.ok ? "text-fern" : "text-heart"}`}>{r.message}</p>}
    </form>
  );
}
