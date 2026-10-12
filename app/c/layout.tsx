import Image from "next/image";
import { requireRole } from "@/lib/data";
import { signOut } from "@/app/actions";
import { LogOut } from "lucide-react";

// Clients: just their chat. No menus, nothing else to find.
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const v = await requireRole("client");
  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Image src="/brand-logo.png" alt="Dogwise Academy" width={132} height={41} priority />
          <form action={signOut}><button className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[14px] text-ink-soft hover:bg-paper" aria-label={`Sign out ${v.name}`}><LogOut size={16} />Sign out</button></form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-5">{children}</main>
    </div>
  );
}
