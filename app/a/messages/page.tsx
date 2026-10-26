import Link from "next/link";
import { listThreads, listTrainers, requireRole } from "@/lib/data";
import { timeAgo } from "@/lib/dates";
import { Avatar, Empty, Pill } from "@/components/ui";
import { ChatsSwitch } from "@/components/ChatsSwitch";
import { unreadChats } from "@/lib/chatData";

export default async function AdminMessages() {
  const v = await requireRole("admin");
  const [threads, trainers, clientUnread] = await Promise.all([listThreads(), listTrainers(), unreadChats(v)]);
  const quiet = trainers.filter((t) => !threads.some((th) => th.trainer.id === t.id));
  return (
    <>
      <h1 className="mb-3 text-h1 font-extrabold">Chats</h1>
      <ChatsSwitch on="trainers" clientUnread={clientUnread} trainerUnread={threads.reduce((n, t) => n + t.unread, 0)} />
      {threads.length ? (
        <ul className="panel divide-y divide-line">
          {threads.map((th) => (
            <li key={th.trainer.id}><Link prefetch={false} href={`/a/messages/${th.trainer.id}`} className="flex items-center gap-3 p-3.5 hover:bg-mint-wash">
              <Avatar name={th.trainer.name} size={42} />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2"><p className={`truncate ${th.unread ? "font-extrabold" : "font-semibold"}`}>{th.trainer.name}</p><span className="shrink-0 text-caption text-ink-faint">{timeAgo(th.last.created_at)}</span></div>
                <p className="truncate text-body text-ink-soft">{th.last.sender_role === "admin" ? "You: " : ""}{th.last.body}</p>
              </div>
              {th.unread > 0 && <Pill tone="heart">{th.unread}</Pill>}
            </Link></li>
          ))}
        </ul>
      ) : <Empty title="No conversations yet." >Start one from any trainer below.</Empty>}
      <details className="mt-6"><summary className="cursor-pointer font-semibold">Message another trainer</summary>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {quiet.map((t) => <li key={t.id}><Link prefetch={false} href={`/a/messages/${t.id}`} className="panel flex items-center gap-3 p-3 hover:bg-mint-wash"><Avatar name={t.name} size={34} /><span className="font-medium">{t.name}</span></Link></li>)}
        </ul>
      </details>
    </>
  );
}
