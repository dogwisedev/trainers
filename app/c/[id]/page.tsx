import Link from "next/link";
import { Avatar } from "@/components/ui";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data";
import { getChat, listChatMessages } from "@/lib/chatData";
import { isDemo } from "@/lib/supabase";
import { ChatThread } from "@/components/ChatThread";
import { ArchivedNotice } from "@/components/ChatBits";
import { ReopenChat } from "@/components/ChatActions";
import { ClipboardList, CreditCard, MessagesSquare } from "lucide-react";
import { BeforeTrainingPopup } from "@/components/BeforeTrainingPopup";
import { chatReadiness } from "@/lib/pretraining";
import { bookingForChat, followupState } from "@/lib/followups";
import { FollowupRequest, type FollowupCard } from "@/components/FollowupRequest";
import { serviceClient } from "@/lib/supabase";
import { daysBetween, todayIso } from "@/lib/dates";

/** The follow-up card: only once the handover report is in (then "Book your follow-up", what's requested, or what's booked). */
async function followupCard(dealKey: string): Promise<FollowupCard | null> {
  if (isDemo()) return null;
  const bookingId = await bookingForChat(dealKey).catch(() => null);
  const st = bookingId ? await followupState(bookingId).catch(() => null) : null;
  if (!st || !st.handedOver) return null;
  const req = st.sessions.find((x) => x.status === "requested"), up = st.sessions.filter((x) => x.status === "confirmed" && x.at && Date.parse(x.at) > Date.now() - 3 * 3600e3).sort((a, z) => (a.at || "").localeCompare(z.at || ""))[0];
  return { n: st.nextN, dog: st.dog, trainer: st.trainer, requested: req?.n ?? null, upcoming: up ? { n: up.n, at: up.at! } : null, done: st.sessions.filter((x) => x.status === "done").length };
}

/** Days until this dog's training starts (negative once started), or null. */
async function daysToStart(dealKey: string): Promise<number | null> {
  if (isDemo() || !/^\d+$/.test(dealKey)) return null;
  const { data } = await serviceClient().from("bookings").select("start_date").eq("hubspot_deal_id", dealKey).neq("status", "cancelled").order("start_date").limit(1).maybeSingle();
  return data?.start_date ? daysBetween(todayIso(), data.start_date) : null;
}

export default async function ClientChat({ params }: { params: { id: string } }) {
  const v = await requireRole("client");
  const chat = await getChat(params.id);
  if (!chat || chat.client_user_id !== v.userId) notFound();
  const [{ messages, hasMore }, ready, startsInDays, followup] = await Promise.all([listChatMessages(chat.id), chat.status === "open" ? chatReadiness(chat.deal_key, true) : Promise.resolve(null), daysToStart(chat.deal_key), chat.status === "open" ? followupCard(chat.deal_key) : Promise.resolve(null)]);
  return (
    <>
      {/* The dog, the trainer, and where to go next */}
      <section className="panel mb-4 overflow-hidden">
        <div className="flex items-center gap-4 bg-[radial-gradient(500px_200px_at_100%_0%,#ece3ff,transparent)] p-4">
          <Avatar name={chat.title || "Dog"} size={56} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-h1 font-extrabold leading-tight">{chat.title || "Your dog"}</h1>
            {chat.trainer_name && <p className="flex items-center gap-1.5 truncate text-body text-ink-soft"><Avatar name={chat.trainer_name} size={20} />{chat.status === "closed" ? "Trained with" : "Training with"} <b className="font-semibold text-ink">{chat.trainer_name}</b></p>}
          </div>
        </div>
        <nav className="flex border-t border-line text-body font-semibold">
          <Link prefetch={false} href={`/c/${chat.id}/profile`} className="flex flex-1 items-center justify-center gap-2 px-3 py-3 hover:bg-paper/60"><ClipboardList size={16} />{chat.title || "Your dog"}&apos;s details</Link>
          <Link prefetch={false} href="/c" className="flex flex-1 items-center justify-center gap-2 border-l border-line px-3 py-3 hover:bg-paper/60"><MessagesSquare size={16} />All chats</Link>
        </nav>
      </section>
      {followup && <FollowupRequest chatId={chat.id} card={followup} />}
      {ready && (ready.left > 0 || ready.balanceLink) && <BeforeTrainingPopup href={`/c/${chat.id}/profile`} left={ready.left} balanceLink={ready.balanceLink} summary={ready.summary} dog={chat.title || "your dog"} startsInDays={startsInDays} />}
      {ready && (ready.left > 0 || ready.balanceLink) && (
        <div data-before-training className="panel mb-4 divide-y divide-line overflow-hidden border-biscuit/60">
          {ready.left > 0 && (
            <Link prefetch={false} href={`/c/${chat.id}/profile`} className="flex items-center gap-3 p-4 hover:bg-paper/50">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-biscuit-wash text-warn"><ClipboardList size={19} /></span>
              <span className="min-w-0 flex-1"><span className="block font-bold">Before training: {ready.left} thing{ready.left > 1 ? "s" : ""} left</span><span className="text-small text-ink-soft">A few quick answers and documents so we&apos;re ready for {chat.title || "your dog"}.</span></span>
              <span className="btn-ink h-9 min-h-0 shrink-0 px-3 text-small">Open</span>
            </Link>
          )}
          {ready.balanceLink && (
            <a href={ready.balanceLink} target="_blank" rel="noopener" className="flex items-center gap-3 p-4 hover:bg-paper/50">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-paper text-lav-deep"><CreditCard size={19} /></span>
              <span className="min-w-0 flex-1"><span className="block font-bold">Remaining balance</span><span className="text-small text-ink-soft">Pay securely online, by card.</span></span>
              <span className="btn-ink h-9 min-h-0 shrink-0 px-3 text-small">Pay</span>
            </a>
          )}
        </div>
      )}
      {chat.archived_at || chat.status === "closed" ? (
        <ArchivedNotice chat={chat} audience="client">{chat.status === "closed" && <ReopenChat chatId={chat.id} base="/c" />}</ArchivedNotice>
      ) : <ChatThread chatId={chat.id} me={{ userId: v.userId, role: "client", name: v.name }} initial={messages} hasMore={hasMore} open={chat.status === "open"} folderUrl={chat.drive_folder_url} demo={isDemo()} withBottomNav={false} otherLabel={`${chat.trainer_name || "your trainer"} and the Dogwise team`} />}
    </>
  );
}
