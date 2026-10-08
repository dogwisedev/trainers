export const dynamic = "force-dynamic";
import { isDemo } from "@/lib/supabase";
import { listTrainers } from "@/lib/data";
import { LoginForm } from "./LoginForm";
import { Brand } from "@/components/Shell";

export default async function Login() {
  const demo = isDemo();
  const trainers = demo ? (await listTrainers()).map((t) => ({ id: t.id, name: t.name })) : [];
  return (
    <main className="relative min-h-dvh overflow-hidden bg-mint px-5 pb-10 pt-[max(28px,env(safe-area-inset-top))]">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-biscuit/40" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-white/50" />
      <div className="relative mx-auto max-w-sm">
        <Brand />
        <h1 className="mt-14 text-[40px] font-extrabold leading-[1.02]">Every kennel,<br />every dog,<br />one calendar.</h1>
        <p className="mt-4 text-[16px] text-ink-soft">Sign in to see your dogs, block time off and message the Dogwise team.</p>
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
