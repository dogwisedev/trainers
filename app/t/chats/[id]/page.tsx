import Link from "next/link";
import { Avatar } from "@/components/ui";
import { notFound } from "next/navigation";
import { CalendarClock, ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { getChat, listChatMessages } from "@/lib/chatData";
import { isDemo } from "@/lib/supabase";
import { ChatThread } from "@/components/ChatThread";
import { ArchivedNotice } from "@/components/ChatBits";
import { ChatMore } from "@/components/ChatMore";
import { chatReadiness } from "@/lib/pretraining";
import { listScheduled } from "@/lib/scheduled";
import { bookingForChat, followupState } from "@/lib/followups";

export default async function TrainerChat({ params }: { params: { id: string } }) {
  const v = await requireRole("trainer");
  const chat = await getChat(params.id);
  if (!chat || (chat.trainer_id !== v.trainerId && !((chat as { extra_trainer_ids?: string[] }).extra_trainer_ids || []).includes(v.trainerId || ""))) notFound();
  const [{ messages, hasMore }, ready, scheduled, fu] = await Promise.all([listChatMessages(chat.id), chatReadiness(chat.deal_key, false), isDemo() ? Promise.resolve([]) : listScheduled(chat.id),
    isDemo() ? Promise.resolve(null) : bookingForChat(chat.deal_key).then((id) => (id ? followupState(id) : null)).catch(() => null)]);
  const fuAsked = fu?.sessions.find((x) => x.status === "requested");
  return (
    <>
      {fu && fuAsked && (
        <Link prefetch={false} href={`/t/followups/${fu.bookingId}`} className="mb-3 flex items-center gap-3 rounded-2xl border-2 border-biscuit bg-biscuit-wash p-3">
          <CalendarClock size={22} className="shrink-0 text-warn" />
          <span className="min-w-0 flex-1 text-body"><b>{chat.client_name || "The client"} asked for follow-up session {fuAsked.n}.</b> Pick a time from their days.</span>
          <span className="btn-ink h-9 min-h-0 shrink-0 px-3 text-small">Confirm</span>
        </Link>
      )}
      <div className="mb-4 flex items-center gap-3">
        <Link prefetch={false} href="/t/chats" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="All chats"><ChevronLeft /></Link>
        <Avatar name={chat.title || "Dog"} size={42} />
        <div className="min-w-0 flex-1"><h1 className="truncate text-h2 font-extrabold leading-tight">{chat.title || "Dog"}</h1><p className="truncate text-body text-ink-soft">{chat.client_name}</p></div>
        <ChatMore profileHref={/^\d+$/.test(chat.deal_key) ? `/t/chats/${chat.id}/profile` : /^[0-9a-f-]{36}$/i.test(chat.deal_key) ? `/t/dogs/${chat.deal_key}` : null} left={ready ? ready.left : null} incidentHref={chat.status === "open" ? `/t/chats/${chat.id}/incident` : null} />
      </div>
      {chat.archived_at ? <ArchivedNotice chat={chat} audience="staff" /> : <ChatThread chatId={chat.id} me={{ userId: v.userId, role: "trainer", name: v.name }} initial={messages} hasMore={hasMore} open={chat.status === "open"} folderUrl={chat.drive_folder_url} demo={isDemo()} withBottomNav otherLabel={`${chat.client_name || "the client"} and the Dogwise team`}
        scheduled={scheduled.map((m) => ({ id: m.id, body: m.body, media: m.media, send_at: m.send_at, sender_name: m.sender_name, mine: m.created_by === v.userId }))} />}
    </>
  );
}
