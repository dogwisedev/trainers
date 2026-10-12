import Link from "next/link";
import { Pill } from "@/components/ui";
import { ChatRow } from "@/lib/chatTypes";
import { timeAgo } from "@/lib/dates";

/** One row in a chat list. */
export function ChatListRow({ chat, href, unread, who, flag }: { chat: ChatRow; href: string; unread: boolean; who: string; flag?: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 p-3.5 hover:bg-mint-wash">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${unread ? "bg-heart" : "bg-transparent"}`} aria-label={unread ? "Unread" : undefined} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{chat.title || "Dog"} <span className="font-normal text-ink-soft">{who}</span></p>
          <p className={`truncate text-[13px] ${unread ? "font-semibold text-ink" : "text-ink-soft"}`}>{chat.last_preview || "No messages yet"}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {chat.last_message_at && <span className="text-[12px] text-ink-faint">{timeAgo(chat.last_message_at)}</span>}
          {flag ? <Pill tone="biscuit">{flag}</Pill> : chat.status === "closed" ? <Pill tone="line">Closed</Pill> : null}
        </div>
      </Link>
    </li>
  );
}
