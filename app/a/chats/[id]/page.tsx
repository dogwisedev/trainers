import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { getChat, listChatMessages } from "@/lib/chatData";
import { isDemo } from "@/lib/supabase";
import { ChatThread } from "@/components/ChatThread";
import { InviteClient } from "@/components/InviteClient";
import { ArchivedNotice } from "@/components/ChatBits";
import { CloseChat, ReopenChat, SendSummaryAgain } from "@/components/ChatActions";
import { ProfileButton } from "@/components/ProfileButton";
import { chatReadiness } from "@/lib/pretraining";

export const maxDuration = 60; // closing a chat saves to Drive and emails the client

export default async function AdminChat({ params }: { params: { id: string } }) {
  const v = await requireRole("admin");
  const chat = await getChat(params.id);
  if (!chat) notFound();
  const [{ messages, hasMore }, ready] = await Promise.all([listChatMessages(chat.id), chatReadiness(chat.deal_key, false)]);
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/a/chats" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="All chats"><ChevronLeft /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[24px] font-extrabold leading-tight">{chat.title || "Dog"}</h1>
          <p className="truncate text-[14px] text-ink-soft">Client {chat.client_name || "?"}, trainer {chat.trainer_id ? <Link className="underline" href={`/a/trainers/${chat.trainer_id}`}>{chat.trainer_name}</Link> : "none"}</p>
        </div>
        {/^\d+$/.test(chat.deal_key) && <ProfileButton href={`/a/chats/${chat.id}/profile`} left={ready ? ready.left : null} />}
        {chat.status === "open" && <CloseChat chatId={chat.id} title={chat.title || "this dog"} />}
      </div>
      <details className="mb-4" open={!chat.client_user_id || !chat.invited_at}>
        <summary className="cursor-pointer text-[14px] font-semibold text-ink-soft">Client access{chat.client_email ? `: ${chat.client_email}` : ""}</summary>
        <div className="mt-2"><InviteClient chatId={chat.id} email={chat.client_email} invitedAt={chat.invited_at} emailsOn={chat.client_emails !== false} /></div>
      </details>
      {chat.archived_at ? (
        <ArchivedNotice chat={chat} audience="staff">
          <div className="flex flex-wrap gap-2"><ReopenChat chatId={chat.id} base="/a/chats" label="Start a new chat" />{chat.client_email && <SendSummaryAgain chatId={chat.id} />}</div>
        </ArchivedNotice>
      ) : <ChatThread chatId={chat.id} me={{ userId: v.userId, role: "admin", name: v.name }} initial={messages} hasMore={hasMore} open={chat.status === "open"} folderUrl={chat.drive_folder_url} demo={isDemo()} withBottomNav otherLabel="the client and trainer" />}
    </>
  );
}
