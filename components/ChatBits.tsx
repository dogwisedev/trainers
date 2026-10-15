import Link from "next/link";
import { Avatar, Pill } from "@/components/ui";
import { ChatRow } from "@/lib/chatTypes";
import { timeAgo } from "@/lib/dates";

/** One row in a chat list. */
export function ChatListRow({ chat, href, unread, who, flag, dates, preview }: { chat: ChatRow; href: string; unread: boolean; who: string; flag?: string; dates?: string; preview?: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-3.5 py-3 hover:bg-paper/60">
        <span className="relative">
          <Avatar name={chat.title || "Dog"} size={42} />
          {unread && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-heart" aria-label="Unread" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate"><span className="font-bold">{chat.title || "Dog"}</span> <span className="text-[14px] text-ink-soft">{who}</span></p>
          <p className={`truncate text-[13px] ${unread ? "font-semibold text-ink" : "text-ink-soft"}`}>{preview ?? (chat.last_preview || "No messages yet")}</p>
          {dates && <p className="truncate text-[12px] text-ink-faint">{dates}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {chat.last_message_at && <span className="text-[12px] text-ink-faint">{timeAgo(chat.last_message_at)}</span>}
          {flag ? <Pill tone="biscuit">{flag}</Pill> : chat.status === "closed" ? <Pill tone="line">Closed</Pill> : null}
        </div>
      </Link>
    </li>
  );
}

/** What people see instead of messages once a chat is closed and archived. */
export function ArchivedNotice({ chat, children, audience }: { chat: ChatRow; children?: React.ReactNode; audience: "client" | "staff" }) {
  const on = chat.closed_at ? new Date(chat.closed_at).toLocaleDateString("en-US") : "";
  return (
    <div className="panel space-y-3 p-5">
      <p className="text-[17px] font-bold">This chat was closed{on ? ` on ${on}` : ""}</p>
      <p className="text-[14px] text-ink-soft">{audience === "client" ? "A copy of the whole chat was emailed to you, and everything is saved." : "The transcript was saved to Drive and emailed to the client, and the messages were cleared from the app."}</p>
      <div className="flex flex-wrap gap-2">
        {chat.transcript_url && <a className="btn-ghost" href={chat.transcript_url} target="_blank" rel="noopener">Read the chat</a>}
        {chat.drive_folder_url && <a className="btn-ghost" href={chat.drive_folder_url} target="_blank" rel="noopener">All photos and videos</a>}
      </div>
      {children}
    </div>
  );
}

/** A group heading in a chat list ("In care now 3"). */
export function ChatGroupTitle({ label, count }: { label: string; count: number }) {
  return <h2 className="group-title">{label} <span className="count">{count}</span></h2>;
}
