import { notFound } from "next/navigation";
import { isDemo } from "@/lib/supabase";
import { contactFromToken, loadForm } from "@/lib/clientForms";
import { SECTIONS } from "@/lib/pretrainingFields";
import { ClientForm } from "@/components/ClientForm";
import Image from "next/image";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // reads HubSpot
export const metadata = { title: "Before training · Dogwise Academy", robots: { index: false } };

// The client's personal before-training questions (from their link; no login).
export default async function ClientFormPage({ params }: { params: { token: string } }) {
  if (isDemo()) return <main className="mx-auto max-w-xl px-4 py-10"><p className="panel p-6">Not available in demo mode.</p></main>;
  const id = contactFromToken(params.token);
  if (!id) notFound();
  const f = await loadForm(id).catch(() => null);
  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-[max(20px,env(safe-area-inset-top))]">
      <div className="mb-5"><Image src="/brand-logo.png" alt="Dogwise Academy" width={132} height={41} priority /></div>
      {f ? <ClientForm token={params.token} f={f} sections={SECTIONS} />
        : <p className="panel p-5 text-body">We couldn&apos;t load your questions just now. Please try again in a minute, or reply to your Dogwise email.</p>}
    </main>
  );
}
