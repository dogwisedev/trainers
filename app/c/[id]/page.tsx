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

export default async function ClientChat({ params }: { params: { id: string } }) {
  const v = await requireRole("client");
  const chat = await getChat(params.id);
  if (!chat || chat.client_user_id !== v.userId) notFound();
  const [{ messages, hasMore }, ready] = await Promise.all([listChatMessages(chat.id), chat.status === "open" ? chatReadiness(chat.deal_key, true) : Promise.resolve(null)]);
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
      {ready && (ready.left > 0 || ready.balanceLink) && <BeforeTrainingPopup href={`/c/${chat.id}/profile`} left={ready.left} balanceLink={ready.balanceLink} summary={ready.summary} dog={chat.title || "your dog"} />}
      {ready && (ready.left > 0 || ready.balanceLink) && (
        <div className="panel mb-4 divide-y divide-line overflow-hidden border-biscuit/60">
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
