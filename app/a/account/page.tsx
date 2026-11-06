import { requireRole } from "@/lib/data";
import { NameForm, PasswordForm } from "@/components/forms";
import { AppSetup } from "@/components/AppSetup";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { canSeePulse } from "@/lib/preview";
import { QuoNumberForm } from "@/components/QuoNumberForm";
import { isDemo, serviceClient } from "@/lib/supabase";

export default async function AdminAccount() {
  const v = await requireRole("admin");
  // Your Quo number: the POC names written on trainer profiles (with how many trainers each), and what's saved
  const sb = isDemo() ? null : serviceClient();
  const [{ data: tr }, mine] = sb ? await Promise.all([
    sb.from("trainers").select("poc").eq("active", true),
    sb.from("profiles").select("quo_number, quo_poc").eq("id", v.userId).maybeSingle()
  ]) : [{ data: [] }, { data: null, error: null }];
  const counts = new Map<string, number>();
  for (const t of (tr || []) as { poc: string | null }[]) { const p = (t.poc || "").replace(/\s+/g, " ").trim(); if (p) counts.set(p, (counts.get(p) || 0) + 1); }
  const options = [...counts.entries()].map(([poc, n]) => ({ poc, n })).sort((a, b) => b.n - a.n);
  const saved = (mine.data || null) as { quo_number: string | null; quo_poc: string | null } | null;
  const me = [v.name.split(" ")[0], (v.email || "").split("@")[0]].map((x) => x.toLowerCase());
  const myPoc = saved?.quo_poc || options.find((o) => me.includes(o.poc.toLowerCase().split(" ")[0]))?.poc || "";
  return (
    <>
      <h1 className="text-h1 font-extrabold">Your account</h1>
      <p className="mb-5 mt-1 text-ink-soft">{v.name}{v.email ? `, ${v.email}` : ""}</p>
      <div className="max-w-md"><AppSetup always /></div>
      {canSeePulse(v.email) && <p className="mb-4 max-w-md"><Link prefetch={false} href="/a/pulse" className="btn-ghost">Pulse</Link></p>}
      <div className="panel mb-4 max-w-md p-4 md:p-5">
        <h2 className="mb-3 text-lead font-bold">Appearance</h2>
        <ThemeToggle />
      </div>
      <div className="panel mb-4 max-w-md p-4 md:p-5">
        <h2 className="text-lead font-bold">Your Quo number</h2>
        <p className="mb-3 mt-1 text-small text-ink-soft">Texts the app sends to the trainers you look after come from this number, so their replies land in your Quo inbox. Leave it empty and they come from the main number.</p>
        {mine.error ? <p className="text-small text-warn">Run migration 051 in Supabase to switch this on.</p> : <QuoNumberForm number={saved?.quo_number || ""} poc={myPoc} options={options} />}
      </div>
      <div className="panel mb-4 max-w-md p-4 md:p-5">
        <h2 className="mb-3 text-lead font-bold">Your name</h2>
        <NameForm current={v.name} />
      </div>
      <div className="panel max-w-md p-4 md:p-5">
        <h2 className="mb-3 text-lead font-bold">{v.passwordSet === false ? "Set a password" : "Change password"}</h2>
        <PasswordForm />
        <p className="mt-3 text-small text-ink-faint">Forgotten it? On the sign-in page, enter your email and leave the password empty: you&apos;ll get a 6-digit code, then set a new password here.</p>
      </div>
    </>
  );
}
 
