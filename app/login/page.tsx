export const dynamic = "force-dynamic";
import { isDemo } from "@/lib/supabase";
import { listTrainers } from "@/lib/data";
import { LoginForm } from "./LoginForm";
import { HashSignIn } from "./HashSignIn";
import { Brand } from "@/components/Shell";

export default async function Login({ searchParams }: { searchParams: { error?: string; detail?: string } }) {
  const demo = isDemo();
  const trainers = demo ? (await listTrainers()).map((t) => ({ id: t.id, name: t.name })) : [];
  return (
    <main className="relative min-h-dvh overflow-hidden bg-mint px-5 pb-10 pt-[max(28px,env(safe-area-inset-top))]">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-biscuit/40" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-white/50" />
      <div className="relative mx-auto max-w-sm">
        <span className="inline-flex rounded-2xl bg-white/90 px-3 py-2 shadow-card"><Brand /></span>
        <h1 className="mt-12 text-[40px] font-extrabold leading-[1.02]">Every kennel,<br />every dog,<br />one calendar.</h1>
        <p className="mt-4 text-[16px] text-ink/75">Sign in to see your dogs, block time off and message the Dogwise team.</p>
        <HashSignIn />
        {searchParams.error && (
          <div role="alert" className="mt-6 rounded-xl bg-white/85 px-4 py-3 text-[14px] text-heart">
            <p>{{
              link: "That link has expired or was already used. Enter your email below, leave the password empty, and we'll send a fresh one.",
              browser: "That sign-in link was opened in a different browser from the one that asked for it. Request a new link and open it in this browser.",
              noprofile: "You're signed in, but this login isn't linked to a trainer or admin profile yet. Ask the Dogwise team to send your login from your trainer profile."
            }[searchParams.error] || "Sign-in didn't work. Request a new link and try again."}</p>
            {searchParams.detail && <p className="mt-1 text-[12px] text-ink-faint">{searchParams.detail}</p>}
          </div>
        )}
        <div className="mt-8 rounded-[26px] bg-white p-5 shadow-[0_20px_50px_-24px_rgba(29,53,87,.45)]">
          <LoginForm demo={demo} trainers={trainers} />
        </div>
        <p className="mt-6 text-center text-[13px] text-ink-soft">
          New trainer? Ask the Dogwise team for your invite. <a className="underline" href="https://dogwiseacademy.com" target="_blank" rel="noopener">dogwiseacademy.com</a>
        </p>
      </div>
    </main>
  );
}
