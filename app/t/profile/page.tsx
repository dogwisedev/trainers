import { TourAgain } from "@/components/TrainerTour";
import { AppSetup } from "@/components/AppSetup";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getTrainer, requireRole } from "@/lib/data";
import { PasswordForm, TrainerForm } from "@/components/forms";
import { Avatar, Section } from "@/components/ui";
import Link from "next/link";
import { CalendarDays, ChevronRight, History, Route, Wallet } from "lucide-react";
import { SignOutButton } from "@/components/SignOutButton";

const MENU = [
  { href: "/t/pay", icon: Wallet, title: "Pay and payslips", text: "Every other Friday, plus your miles" },
  { href: "/t/calendar", icon: CalendarDays, title: "Calendar and time off", text: "Block dates you can't take dogs" },
  { href: "/t/followup", icon: Route, title: "Log a follow-up session", text: "Miles go on your next payslip" },
  { href: "/t/past", icon: History, title: "Past dogs", text: "Dogs you've finished, with their forms" }
];

export default async function TrainerProfile() {
  const v = await requireRole("trainer");
  const t = v.trainerId ? await getTrainer(v.trainerId) : null;
  if (!t) return null;
  return (
    <>
      <div className="flex items-center gap-4">
        <Avatar name={t.name} size={64} />
        <div><h1 className="text-h1 font-extrabold leading-tight">{t.name}</h1><p className="text-ink-soft">{[t.city, t.state].filter(Boolean).join(", ")}</p></div>
      </div>
      <ul className="panel mt-5 divide-y divide-line overflow-hidden">
        {MENU.map(({ href, icon: I, title, text }) => (
          <li key={href}><Link href={href} className="flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-paper/60">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper text-lav-deep"><I size={19} /></span>
            <span className="min-w-0 flex-1"><span className="block font-semibold">{title}</span><span className="block text-small text-ink-soft">{text}</span></span>
            <ChevronRight size={18} className="text-ink-faint" />
          </Link></li>
        ))}
      </ul>
      <div className="mt-5" data-tour="setup"><AppSetup always /></div>
      <TourAgain />
      <div className="mt-5 grid grid-cols-2 gap-3 text-body">
        <div className="panel p-4"><p className="text-ink-soft">Dogs at one time</p><p className="text-h3 font-bold">{t.capacity}</p></div>
        <div className="panel p-4"><p className="text-ink-soft">Driving range</p><p className="font-bold">{t.range_text || `${t.range_miles} miles`}</p></div>
        <div className="panel col-span-2 p-4"><p className="text-ink-soft">Programs</p><p className="font-semibold">{t.programs || "Not set"}</p></div>
      </div>
      <p className="mt-3 text-small text-ink-faint">Need your capacity, range or programs changed? Message the Dogwise team.</p>
      <Section title="Your details"><TrainerForm t={t} admin={false} /></Section>
      <Section title="Appearance"><div className="panel p-4"><ThemeToggle /></div></Section>
      <Section title="Password" className="scroll-mt-20"><div id="password" className="panel p-4"><PasswordForm /></div></Section>
      <div className="mt-6 flex justify-center pb-4"><SignOutButton className="btn-ghost w-full max-w-xs justify-center" /></div>
    </>
  );
}
