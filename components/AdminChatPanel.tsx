import { listChatMessages } from "@/lib/chatData";
import type { ChatRow } from "@/lib/chatTypes";
import { isDemo, serviceClient } from "@/lib/supabase";
import { ChatThread } from "@/components/ChatThread";
import { InviteClient } from "@/components/InviteClient";
import { ArchivedNotice } from "@/components/ChatBits";
import { ReopenChat, SendSummaryAgain } from "@/components/ChatActions";
import { listScheduled } from "@/lib/scheduled";

/** What needs doing about the client's access, if anything (shown on the chat's header without opening Info). */
export const clientAccessProblem = (chat: ChatRow) => (!chat.client_email ? "No client email" : !chat.invited_at ? "Client not invited yet" : null);

/** Whether the client has joined, and their access (email, invite, emails on or off). On the Chats page it sits in the
 *  header's Info; on the dog page it's above the thread. */
export async function AdminChatInfo({ chat }: { chat: ChatRow }) {
  const seen = chat.client_user_id && !isDemo() ? await serviceClient().from("chat_reads").select("last_read_at").eq("chat_id", chat.id).eq("user_id", chat.client_user_id).maybeSingle().then((r) => (r.data?.last_read_at as string | undefined) || null) : null;
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  const status = !chat.client_email ? { t: "No client email", tone: "text-heart" } : !chat.invited_at ? { t: "Client not invited yet", tone: "text-heart" }
    : seen ? { t: `Client joined: last opened the chat ${when(seen)}`, tone: "text-fern" } : { t: `Client hasn't opened the chat yet (invited ${when(chat.invited_at)})`, tone: "text-warn" };
  return (
    <div>
      <p className={`mb-2 text-body font-semibold ${status.tone}`}>{status.t}</p>
      <details open={!chat.client_user_id || !chat.invited_at}>
        <summary className="cursor-pointer text-body font-semibold text-ink-soft">Client access{chat.client_email ? `: ${chat.client_email}` : ""}{!chat.invited_at ? " (not invited yet)" : ""}</summary>
        <div className="mt-2"><InviteClient chatId={chat.id} email={chat.client_email} invitedAt={chat.invited_at} emailsOn={chat.client_emails !== false} /></div>
      </details>
    </div>
  );
}

/** The chat itself for admins (the thread or the archive notice). `access={false}` when the page shows AdminChatInfo itself. */
export async function AdminChatPanel({ chat, me, access = true }: { chat: ChatRow; me: { userId: string; name: string }; access?: boolean }) {
  const [{ messages, hasMore }, scheduled] = await Promise.all([listChatMessages(chat.id), isDemo() ? Promise.resolve([]) : listScheduled(chat.id)]);
  return (
    <>
      {access && <div className="mb-4"><AdminChatInfo chat={chat} /></div>}
      {chat.archived_at ? (
        <ArchivedNotice chat={chat} audience="staff">
          <div className="flex flex-wrap gap-2"><ReopenChat chatId={chat.id} base="/a/chats" label="Start a new chat" />{chat.client_email && <SendSummaryAgain chatId={chat.id} />}</div>
        </ArchivedNotice>
      ) : <ChatThread chatId={chat.id} me={{ userId: me.userId, role: "admin", name: me.name }} initial={messages} hasMore={hasMore} open={chat.status === "open"} folderUrl={chat.drive_folder_url} demo={isDemo()} withBottomNav otherLabel="the client and trainer"
          scheduled={scheduled.map((m) => ({ id: m.id, body: m.body, media: m.media, send_at: m.send_at, sender_name: m.sender_name, mine: m.created_by === me.userId }))} />}
    </>
  );
}
