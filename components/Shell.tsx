"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { CalendarDays, ClipboardList, Home, KeyRound, LayoutGrid, LogOut, MessageCircle, MessagesSquare, UserRound, Users, Wallet } from "lucide-react";
import { PasswordForm } from "@/components/forms";
import { signOut } from "@/app/actions";

const ICONS = { home: Home, calendar: CalendarDays, messages: MessageCircle, profile: UserRound, grid: LayoutGrid, users: Users, pay: Wallet, reports: ClipboardList, chats: MessagesSquare };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; also?: string[] };

export function Shell({ nav, who, children, demo, accountHref, needsPassword }: { nav: NavItem[]; who: string; children: React.ReactNode; demo?: boolean; accountHref: string; needsPassword?: boolean }) {
  const path = usePathname();
  const isActive = (href: string) => (href === nav[0].href ? path === href : path.startsWith(href) || !!nav.find((n) => n.href === href)?.also?.some((a) => path.startsWith(a)));
  return (
    <div className="md:flex">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-white p-5 md:flex">
        <Brand />
        <nav className="mt-8 flex flex-col gap-1">
          {nav.map((n) => {
            const I = ICONS[n.icon];
            return (
              <Link key={n.href} href={n.href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium ${isActive(n.href) ? "bg-mint text-ink" : "text-ink-soft hover:bg-mint-wash"}`}>
                <I size={19} /> {n.label}
                {!!n.badge && <span className="ml-auto rounded-full bg-heart px-2 text-[12px] font-bold text-white">{n.badge}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-line pt-4 text-[13px] text-ink-soft">
          <p className="truncate font-semibold text-ink">{who}</p>
          <Link href={accountHref} className="mt-2 flex items-center gap-2 hover:text-ink"><KeyRound size={15} />Password</Link>
          <form action={signOut}><button className="mt-2 inline-flex items-center gap-2 hover:text-ink"><LogOut size={15} />Sign out</button></form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-paper/90 px-4 pb-2.5 pt-[max(10px,env(safe-area-inset-top))] backdrop-blur md:hidden">
          <Brand small />
          <div className="flex items-center">
            <Link href={accountHref} className="grid h-10 w-10 place-items-center rounded-full text-ink-soft" aria-label="Password"><KeyRound size={18} /></Link>
            <form action={signOut}><button className="grid h-10 w-10 place-items-center rounded-full text-ink-soft" aria-label="Sign out"><LogOut size={18} /></button></form>
          </div>
        </header>
        {demo && <DemoNote />}
        <main className="mx-auto w-full max-w-5xl px-4 pb-32 pt-5 md:px-8 md:pb-12 md:pt-8">
          {needsPassword && !path.startsWith("/a/account") && (
            <div className="mb-5 rounded-[22px] border border-biscuit bg-biscuit-wash p-4 md:p-5">
              <p className="font-bold">Set a password</p>
              <p className="mb-3 text-[14px] text-ink-soft">You signed in with an email link. Choose a password so you can sign in with your email and password next time.</p>
              <div className="max-w-sm"><PasswordForm /></div>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur md:hidden">
        <ul className="mx-auto flex max-w-md justify-around">
          {nav.map((n) => {
            const I = ICONS[n.icon];
            const on = isActive(n.href);
            return (
              <li key={n.href}>
                <Link href={n.href} className="relative flex min-w-[58px] flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-semibold">
                  <span className={`grid h-8 w-14 place-items-center rounded-full ${on ? "bg-mint text-ink" : "text-ink-faint"}`}><I size={20} /></span>
                  <span className={on ? "text-ink" : "text-ink-faint"}>{n.label}</span>
                  {!!n.badge && <span className="absolute right-2 top-0 rounded-full bg-heart px-1.5 text-[10px] font-bold text-white">{n.badge}</span>}
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
  return <div className="bg-biscuit-wash px-4 py-2 text-center text-[13px] text-[#8A5A00]">Demo with today&apos;s sheet data. Connect Supabase to save changes.</div>;
}

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className={`grid place-items-center rounded-2xl bg-mint ${small ? "h-9 w-9" : "h-11 w-11"}`}>
        <Image src="/logo.png" alt="" width={small ? 28 : 34} height={small ? 28 : 34} />
      </span>
      <span className="leading-none">
        <span className={`block font-extrabold tracking-tight ${small ? "text-[17px]" : "text-[19px]"}`}>Dogwise<span className="text-fern">Trainers</span></span>
        {!small && <span className="mt-1 block text-[12px] text-ink-faint">Dogwise Academy</span>}
      </span>
    </Link>
  );
}
