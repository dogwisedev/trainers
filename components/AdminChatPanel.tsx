import { listChatMessages } from "@/lib/chatData";
import type { ChatRow } from "@/lib/chatTypes";
import { isDemo } from "@/lib/supabase";
import { ChatThread } from "@/components/ChatThread";
import { InviteClient } from "@/components/InviteClient";
import { ArchivedNotice } from "@/components/ChatBits";
import { ReopenChat, SendSummaryAgain } from "@/components/ChatActions";

/** The chat itself for admins (client access, the thread or the archive notice). Used on the Chats page and the dog page. */
export async function AdminChatPanel({ chat, me }: { chat: ChatRow; me: { userId: string; name: string } }) {
  const { messages, hasMore } = await listChatMessages(chat.id);
  return (
    <>
      <details className="mb-4" open={!chat.client_user_id || !chat.invited_at}>
        <summary className="cursor-pointer text-[14px] font-semibold text-ink-soft">Client access{chat.client_email ? `: ${chat.client_email}` : ""}{!chat.invited_at ? " (not invited yet)" : ""}</summary>
        <div className="mt-2"><InviteClient chatId={chat.id} email={chat.client_email} invitedAt={chat.invited_at} emailsOn={chat.client_emails !== false} /></div>
      </details>
      {chat.archived_at ? (
        <ArchivedNotice chat={chat} audience="staff">
          <div className="flex flex-wrap gap-2"><ReopenChat chatId={chat.id} base="/a/chats" label="Start a new chat" />{chat.client_email && <SendSummaryAgain chatId={chat.id} />}</div>
        </ArchivedNotice>
      ) : <ChatThread chatId={chat.id} me={{ userId: me.userId, role: "admin", name: me.name }} initial={messages} hasMore={hasMore} open={chat.status === "open"} folderUrl={chat.drive_folder_url} demo={isDemo()} withBottomNav otherLabel="the client and trainer" />}
    </>
  );
}
