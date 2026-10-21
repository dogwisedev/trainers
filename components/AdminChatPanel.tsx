import { listChatMessages } from "@/lib/chatData";
import type { ChatRow } from "@/lib/chatTypes";
import { isDemo, serviceClient } from "@/lib/supabase";
import { ChatThread } from "@/components/ChatThread";
import { InviteClient } from "@/components/InviteClient";
import { ArchivedNotice } from "@/components/ChatBits";
import { ReopenChat, SendSummaryAgain } from "@/components/ChatActions";

/** The chat itself for admins (client access, the thread or the archive notice). Used on the Chats page and the dog page. */
export async function AdminChatPanel({ chat, me }: { chat: ChatRow; me: { userId: string; name: string } }) {
  const [{ messages, hasMore }, seen] = await Promise.all([
    listChatMessages(chat.id),
    chat.client_user_id && !isDemo() ? serviceClient().from("chat_reads").select("last_read_at").eq("chat_id", chat.id).eq("user_id", chat.client_user_id).maybeSingle().then((r) => (r.data?.last_read_at as string | undefined) || null) : Promise.resolve(null)
  ]);
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  const status = !chat.client_email ? { t: "No client email", tone: "text-heart" } : !chat.invited_at ? { t: "Client not invited yet", tone: "text-heart" }
    : seen ? { t: `Client joined: last opened the chat ${when(seen)}`, tone: "text-fern" } : { t: `Client hasn't opened the chat yet (invited ${when(chat.invited_at)})`, tone: "text-[#8A5A00]" };
  return (
    <>
      <p className={`mb-2 text-[14px] font-semibold ${status.tone}`}>{status.t}</p>
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
