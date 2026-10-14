import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data";
import { getChat, listChatMessages } from "@/lib/chatData";
import { isDemo } from "@/lib/supabase";
import { ChatThread } from "@/components/ChatThread";
import { ArchivedNotice } from "@/components/ChatBits";
import { ReopenChat } from "@/components/ChatActions";
import { ClipboardList, CreditCard } from "lucide-react";
import { BeforeTrainingPopup } from "@/components/BeforeTrainingPopup";
import { chatReadiness } from "@/lib/pretraining";

export default async function ClientChat({ params }: { params: { id: string } }) {
  const v = await requireRole("client");
  const chat = await getChat(params.id);
  if (!chat || chat.client_user_id !== v.userId) notFound();
  const [{ messages, hasMore }, ready] = await Promise.all([listChatMessages(chat.id), chat.status === "open" ? chatReadiness(chat.deal_key, true) : Promise.resolve(null)]);
  return (
    <>
      <h1 className="text-[26px] font-extrabold leading-tight">{chat.title || "Your dog"}</h1>
      <p className="mb-4 text-[14px] text-ink-soft">{chat.trainer_name ? `Training with ${chat.trainer_name}. ` : ""}<Link href="/c" className="underline">All chats</Link>{ready && <> · <Link href={`/c/${chat.id}/profile`} className="underline">Your dog&apos;s details</Link></>}</p>
      {ready && (ready.left > 0 || ready.balanceLink) && <BeforeTrainingPopup href={`/c/${chat.id}/profile`} left={ready.left} balanceLink={ready.balanceLink} dog={chat.title || "your dog"} />}
      {ready && (ready.left > 0 || ready.balanceLink) && (
        <div className="panel mb-4 space-y-3 border-biscuit p-4">
          {ready.left > 0 && (
            <Link href={`/c/${chat.id}/profile`} className="flex items-center gap-3">
              <ClipboardList size={22} className="shrink-0" />
              <span className="min-w-0 flex-1"><span className="block font-bold">Before training: {ready.left} thing{ready.left > 1 ? "s" : ""} left</span><span className="text-[13px] text-ink-soft">Answer the missing questions and send the vaccine records.</span></span>
              <span className="btn-ink h-9 min-h-0 px-3 text-[13px]">Open</span>
            </Link>
          )}
          {ready.balanceLink && <a href={ready.balanceLink} target="_blank" rel="noopener" className="btn-ghost w-full"><CreditCard size={17} />Pay the remaining balance</a>}
        </div>
      )}
      {chat.archived_at || chat.status === "closed" ? (
        <ArchivedNotice chat={chat} audience="client">{chat.status === "closed" && <ReopenChat chatId={chat.id} base="/c" />}</ArchivedNotice>
      ) : <ChatThread chatId={chat.id} me={{ userId: v.userId, role: "client", name: v.name }} initial={messages} hasMore={hasMore} open={chat.status === "open"} folderUrl={chat.drive_folder_url} demo={isDemo()} withBottomNav={false} otherLabel={`${chat.trainer_name || "your trainer"} and the Dogwise team`} />}
    </>
  );
}
