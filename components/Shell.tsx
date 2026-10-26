"use client";
import Link from "next/link";
import { useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { CalendarDays, ClipboardList, Home, KeyRound, LayoutGrid, MessageCircle, MessagesSquare, TriangleAlert, UserRound, Users, Wallet, PawPrint, ListChecks, TrendingUp } from "lucide-react";
import { PasswordForm } from "@/components/forms";
import { Avatar } from "@/components/ui";
import { AppSetup } from "@/components/AppSetup";
import { SignOutButton } from "@/components/SignOutButton";
import { TourInvite } from "@/components/TrainerTour";

const ICONS = { home: Home, calendar: CalendarDays, messages: MessageCircle, profile: UserRound, grid: LayoutGrid, users: Users, pay: Wallet, reports: ClipboardList, chats: MessagesSquare, alert: TriangleAlert, paw: PawPrint, todo: ListChecks, sales: TrendingUp };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; also?: string[] };

export function Shell({ nav, who, children, demo, accountHref, needsPassword, headerActions = true, tourHome }: { nav: NavItem[]; who: string; children: React.ReactNode; demo?: boolean; accountHref: string; needsPassword?: boolean; headerActions?: boolean; tourHome?: string }) {
  const path = usePathname();
  // First visit, one thing at a time: set a password, then get the app on the phone, then the tour
  const [setupShowing, setSetupShowing] = useState<boolean | null>(null);
  const setupDone = demo || setupShowing === false;
  const also = (href: string) => !!nav.find((n) => n.href === href)?.also?.some((a) => path === a || path.startsWith(`${a}/`) || path.startsWith(`${a}?`));
  const isActive = (href: string) => (href === nav[0].href ? path === href || also(href) : path.startsWith(href) || also(href));
  return (
    <div className="md:flex">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-white p-5 md:flex">
        <Brand />
        <nav className="mt-8 flex flex-col gap-1">
          {nav.map((n) => {
            const I = ICONS[n.icon];
            return (
              <Link key={n.href} href={n.href} data-tour={`nav-${n.label.toLowerCase()}`} aria-current={isActive(n.href) ? "page" : undefined} className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-body ${isActive(n.href) ? "bg-paper font-bold text-ink before:absolute before:-left-5 before:top-2 before:h-[calc(100%-16px)] before:w-1 before:rounded-r-full before:bg-lav" : "font-medium text-ink-soft hover:bg-canvas hover:text-ink"}`}>
                <I size={19} className={isActive(n.href) ? "text-lav-deep" : ""} /> {n.label}
                {!!n.badge && <span className="ml-auto grid h-[22px] min-w-[22px] place-items-center rounded-full bg-heart px-1.5 text-caption font-bold text-white">{n.badge}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-line pt-4 text-small text-ink-soft">
          <p className="flex items-center gap-2.5 truncate font-semibold text-ink"><Avatar name={who} size={32} />{who}</p>
          <Link prefetch={false} href={accountHref} className="mt-2 flex items-center gap-2 hover:text-ink"><KeyRound size={15} />Your account</Link>
          <SignOutButton className="mt-2" />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line/70 bg-white/85 px-4 pb-2 pt-[max(8px,env(safe-area-inset-top))] backdrop-blur-md md:hidden">
          <Brand small />
          {headerActions && (
            <div className="flex items-center">
              <Link prefetch={false} href={accountHref} className="grid h-11 w-11 place-items-center rounded-full text-ink-soft" aria-label="Your account"><KeyRound size={18} /></Link>
              <SignOutButton variant="icon" />
            </div>
          )}
        </header>
        {demo && <DemoNote />}
        <main className="mx-auto w-full max-w-5xl px-4 pb-32 pt-5 md:px-8 md:pb-12 md:pt-8">
          {!demo && !path.endsWith("/account") && !path.endsWith("/profile") && <AppSetup quiet={!!needsPassword} onShowing={setSetupShowing} />}
          {needsPassword && !path.startsWith("/a/account") && (
            <div className="mb-5 rounded-[22px] border border-biscuit bg-biscuit-wash p-4 md:p-5">
              <p className="font-bold">Set a password</p>
              <p className="mb-3 text-body text-ink-soft">You signed in with an email link. Choose a password so you can sign in with your email and password next time.</p>
              <div className="max-w-sm"><PasswordForm /></div>
            </div>
          )}
          {tourHome && path === tourHome && !needsPassword && setupDone && <TourInvite />}
          {children}
        </main>
      </div>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-white/90 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-8px_24px_-12px_rgba(40,24,112,.18)] backdrop-blur-md md:hidden">
        <ul className="mx-auto flex max-w-md justify-around">
          {nav.map((n) => {
            const I = ICONS[n.icon];
            const on = isActive(n.href);
            return (
              <li key={n.href}>
                <Link href={n.href} data-tour={`nav-${n.label.toLowerCase()}`} aria-current={on ? "page" : undefined} className="relative flex min-w-[56px] flex-col items-center gap-1 px-1 py-1 text-micro font-semibold">
                  <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${on ? "bg-paper text-lav-deep" : "text-ink-faint"}`}><I size={20} strokeWidth={on ? 2.4 : 2} /></span>
                  <span className={on ? "font-bold text-ink" : "text-ink-faint"}>{n.label}</span>
                  {!!n.badge && <span className="absolute right-2.5 top-0 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-heart px-1 text-micro font-bold text-white ring-2 ring-white">{n.badge}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function DemoNote() {
  return <div className="bg-biscuit-wash px-4 py-2 text-center text-small text-warn">Demo with today&apos;s sheet data. Connect Supabase to save changes.</div>;
}

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link prefetch={false} href="/" className="flex items-center gap-2.5">
      <Image src="/brand-logo.png" alt="Dogwise Academy" width={small ? 112 : 140} height={small ? 36 : 45} priority />
    </Link>
  );
}
