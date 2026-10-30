export const dynamic = "force-dynamic";
import Image from "next/image";
import { HeartHandshake, MessagesSquare, PawPrint } from "lucide-react";
import { isDemo } from "@/lib/supabase";
import { listTrainers } from "@/lib/data";
import { LoginForm } from "./LoginForm";
import { HashSignIn } from "./HashSignIn";
import { BrandLogo } from "@/components/BrandLogo";

// Sign in, for everyone: dog owners, trainers, the Dogwise team and sales.
export default async function Login({ searchParams }: { searchParams: { error?: string; detail?: string } }) {
  const demo = isDemo();
  const trainers = demo ? (await listTrainers()).map((t) => ({ id: t.id, name: t.name })) : [];
  const who = [
    { icon: PawPrint, title: "Dog owners", text: "Follow your dog's training, with photos and videos." },
    { icon: MessagesSquare, title: "Trainers", text: "Your dogs, client chats, forms and pay." },
    { icon: HeartHandshake, title: "The Dogwise team", text: "Everything that keeps it all running." }
  ];
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[radial-gradient(900px_700px_at_90%_-10%,#ece3ff_0%,#F8F6FD_60%)] px-5 pb-10 pt-[max(24px,env(safe-area-inset-top))]">
      <div className="relative mx-auto grid max-w-5xl gap-8 md:grid-cols-[1.1fr_1fr] md:items-center md:gap-14 md:pt-10">
        <div>
          <BrandLogo width={150} height={48} />
          <h1 className="mt-10 text-hero font-extrabold leading-[1.02] md:text-hero-lg">Welcome to<br />Dogwise.</h1>
          <p className="mt-4 max-w-md text-lead leading-relaxed text-ink-soft">Dogs, owners, trainers and the team, all in one place.</p>
          <ul className="mt-7 hidden space-y-3 md:block">
            {who.map(({ icon: I, title, text }) => (
              <li key={title} className="flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-white text-lav-deep shadow-card"><I size={19} /></span><span><b className="block text-body">{title}</b><span className="text-body text-ink-soft">{text}</span></span></li>
            ))}
          </ul>
        </div>
        <div className="relative">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-28 hidden h-56 w-56 overflow-hidden rounded-full bg-[radial-gradient(circle_at_40%_35%,#fff,#ece3ff_60%,#dccdff)] md:block">
            <Image src="/hero-dog.png" alt="" width={260} height={260} className="absolute bottom-0 left-1/2 h-[92%] w-auto -translate-x-1/2" />
          </div>
          <HashSignIn />
          {searchParams.error && (
            <div role="alert" className="mb-4 rounded-2xl border border-heart/20 bg-white px-4 py-3 text-body text-heart shadow-card">
              <p>{{
                link: "That link has expired or was already used. Enter your email below, leave the password empty, and we'll email you a 6-digit code.",
                browser: "That sign-in link was opened in a different browser from the one that asked for it. Enter your email below and use the 6-digit code instead.",
                noprofile: "You're signed in, but your account isn't set up yet. Email info@dogwiseacademy.com and we'll sort it out."
              }[searchParams.error] || "Signing in didn't work. Ask for a new link and try again."}</p>
              {searchParams.detail && <p className="mt-1 text-caption text-ink-faint">{searchParams.detail}</p>}
            </div>
          )}
          <div className="relative rounded-[28px] border border-line bg-white p-6 shadow-[0_30px_60px_-30px_rgba(40,24,112,.35)] md:p-8">
            <h2 className="text-h2 font-extrabold">Sign in</h2>
            <p className="mb-5 mt-1 text-body text-ink-soft">With the email you gave Dogwise.</p>
            <LoginForm demo={demo} trainers={trainers} />
          </div>
          <p className="mt-5 text-center text-small text-ink-soft">Need help signing in? Email <a className="font-semibold underline" href="mailto:info@dogwiseacademy.com">info@dogwiseacademy.com</a></p>
          <ul className="mt-7 space-y-2.5 md:hidden">
            {who.map(({ icon: I, title, text }) => (
              <li key={title} className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-lav-deep shadow-card"><I size={17} /></span><span className="text-body"><b>{title}</b> <span className="text-ink-soft">{text}</span></span></li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
