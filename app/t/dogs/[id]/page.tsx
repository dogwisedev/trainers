import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MessageCircle } from "lucide-react";
import { requireRole } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { loadProfile } from "@/lib/pretraining";
import { ensureChatsForBookings } from "@/lib/chat";
import { range } from "@/lib/dates";
import { contactFrom } from "@/lib/contactLinks";
import { ClientCard } from "@/components/ClientCard";
import { DogProfile } from "@/components/DogProfile";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // may read HubSpot

// "Info" for one of the trainer's dogs, straight from Today: the client (directions, call, text, email), key facts for
// pickup and everything the client filled in. Works from the booking, so a dog without a chat yet still has its info.
export default async function DogInfo({ params, searchParams }: { params: { id: string }; searchParams: { dog?: string } }) {
  const v = await requireRole("trainer");
  if (isDemo()) return <p className="panel p-6 text-ink-soft">Dog info needs the database: not available in demo mode.</p>;
  const sb = serviceClient();
  const { data } = await sb.from("bookings").select("*").eq("id", params.id).maybeSingle();
  const b = data as Booking | null;
  if (!b || b.status === "cancelled" || b.trainer_id !== v.trainerId) notFound();
  const deal = /^\d+$/.test(b.hubspot_deal_id || "") ? b.hubspot_deal_id! : null;

  // The deal's chat (made now if the dog has none yet; no email goes out)
  let chatId: string | null = null;
  if (deal) {
    const { data: chats } = await sb.from("chats").select("id, status").eq("deal_key", deal).order("created_at", { ascending: false });
    const rows = (chats || []) as { id: string; status: string }[];
    chatId = (rows.find((c) => c.status === "open") || rows[0])?.id || null;
    if (!chatId) chatId = (await ensureChatsForBookings([b], { invite: false }).catch(() => []))[0]?.chatId || null;
  }
  const profile = deal ? await loadProfile(deal).catch(() => null) : null;

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link prefetch={false} href="/t" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-paper" aria-label="Back to Today"><ChevronLeft /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-h2 font-extrabold leading-tight">{b.dog_name || "Dog"}</h1>
          <p className="truncate text-body text-ink-soft">{b.client_name} · {range(b.start_date, b.end_date)}</p>
        </div>
        {chatId && <Link prefetch={false} href={`/t/chats/${chatId}`} className="btn-ghost h-11 min-h-0 shrink-0 px-3"><MessageCircle size={17} />Chat</Link>}
      </div>
      {profile && chatId ? (
        <DogProfile chatId={chatId} role="trainer" edit={false} open profile={profile} dogId={searchParams.dog || b.id} base={`/t/dogs/${b.id}`} />
      ) : (
        <div className="space-y-4">
          <ClientCard c={{ ...contactFrom(null, b.client_name), email: b.client_email || "" }} dogs={b.dog_name || undefined} />
          <p className="panel p-4 text-body text-ink-soft">
            {deal ? "Couldn't load the client's forms from HubSpot just now. Try again in a minute." : "This dog isn't linked to its HubSpot deal yet, so the client's forms and address aren't here. Ask the team to link it."}
          </p>
        </div>
      )}
    </>
  );
}
