import Link from "next/link";
import { listThreads, listTrainers, requireRole } from "@/lib/data";
import { timeAgo } from "@/lib/dates";
import { Avatar, Empty, Pill } from "@/components/ui";

export default async function AdminMessages() {
  await requireRole("admin");
  const [threads, trainers] = await Promise.all([listThreads(), listTrainers()]);
  const quiet = trainers.filter((t) => !threads.some((th) => th.trainer.id === t.id));
  return (
    <>
      <h1 className="mb-4 text-[30px] font-extrabold">Messages</h1>
      {threads.length ? (
        <ul className="panel divide-y divide-line">
          {threads.map((th) => (
            <li key={th.trainer.id}><Link href={`/a/messages/${th.trainer.id}`} className="flex items-center gap-3 p-3.5 hover:bg-mint-wash">
              <Avatar name={th.trainer.name} size={42} />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2"><p className={`truncate ${th.unread ? "font-extrabold" : "font-semibold"}`}>{th.trainer.name}</p><span className="shrink-0 text-[12px] text-ink-faint">{timeAgo(th.last.created_at)}</span></div>
                <p className="truncate text-[14px] text-ink-soft">{th.last.sender_role === "admin" ? "You: " : ""}{th.last.body}</p>
              </div>
              {th.unread > 0 && <Pill tone="heart">{th.unread}</Pill>}
            </Link></li>
          ))}
        </ul>
      ) : <Empty title="No conversations yet." >Start one from any trainer below.</Empty>}
      <details className="mt-6"><summary className="cursor-pointer font-semibold">Message another trainer</summary>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {quiet.map((t) => <li key={t.id}><Link href={`/a/messages/${t.id}`} className="panel flex items-center gap-3 p-3 hover:bg-mint-wash"><Avatar name={t.name} size={34} /><span className="font-medium">{t.name}</span></Link></li>)}
        </ul>
      </details>
    </>
  );
}
