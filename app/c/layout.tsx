import { ClientSetup } from "@/components/ClientSetup";
import Image from "next/image";
import { requireRole } from "@/lib/data";
import { SignOutButton } from "@/components/SignOutButton";

// Clients: just their chat. No menus, nothing else to find.
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const v = await requireRole("client");
  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Image src="/brand-logo.png" alt="Dogwise Academy" width={132} height={41} priority />
          <SignOutButton className="rounded-full px-3 py-2 text-body text-ink-soft hover:bg-paper" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-5">{!v.demo && <ClientSetup />}{children}</main>
    </div>
  );
}
