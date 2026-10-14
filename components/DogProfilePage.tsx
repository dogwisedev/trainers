import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { isDemo } from "@/lib/supabase";
import { profileAccess } from "@/lib/pretrainingAccess";
import { loadProfile } from "@/lib/pretraining";
import { DogProfile } from "@/components/DogProfile";

/** The Dog profile page (admin, trainer and client versions): before-training checklist and the client's answers. */
export async function DogProfilePage({ chatId, dog, back }: { chatId: string; dog?: string; back: string }) {
  if (isDemo()) return <p className="panel p-6 text-ink-soft">The Dog profile needs HubSpot and Supabase: it isn&apos;t available in demo mode.</p>;
  const a = await profileAccess(chatId);
  if (!a) notFound();
  const role = a.v.role as "admin" | "trainer" | "client";
  const profile = a.dealId ? await loadProfile(a.dealId) : null;
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link href={back} className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back to the chat"><ChevronLeft /></Link>
        <div className="min-w-0">
          <h1 className="truncate text-[24px] font-extrabold leading-tight">{role === "client" ? "Before training" : "Dog profile"}</h1>
          <p className="truncate text-[14px] text-ink-soft">{a.chat.title || "Dog"}{role !== "client" && a.chat.client_name ? `, ${a.chat.client_name}` : ""}</p>
        </div>
      </div>
      {!profile ? (
        <p className="panel p-6 text-ink-soft">{a.dealId ? "Couldn't load this dog's details from HubSpot. Try again in a minute." : "This booking has no HubSpot deal, so there are no client forms to show."}</p>
      ) : (
        <DogProfile chatId={a.chat.id} role={role} edit={a.edit} open={a.chat.status === "open"} profile={profile} dogId={dog || profile.dogs[0]?.booking.id} base={`${back}/profile`} />
      )}
    </>
  );
}
