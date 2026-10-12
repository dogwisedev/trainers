import Link from "next/link";
import { requireRole, unreadForAdmin } from "@/lib/data";
import { listChats } from "@/lib/chatData";
import { chatUnread } from "@/lib/chatTypes";
import { ChatListRow } from "@/components/ChatBits";
import { Empty } from "@/components/ui";

export default async function AdminChats({ searchParams }: { searchParams: { f?: string } }) {
  await requireRole("admin");
  const [all, teamUnread] = await Promise.all([listChats(), unreadForAdmin()]);
  const closed = searchParams.f === "closed";
  const chats = all.filter((c) => (closed ? c.status === "closed" : c.status === "open"));
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Chats</h1>
      <p className="mb-4 mt-1 text-ink-soft">One chat per booking: the client, the trainer and the whole Dogwise team. Any admin can open any chat.</p>
      <Link href="/a/messages" className="panel mb-4 flex items-center justify-between gap-3 p-3.5 hover:bg-mint-wash">
        <span><span className="font-bold">Trainer messages</span> <span className="text-[13px] text-ink-soft">direct messages with trainers</span></span>
        {teamUnread > 0 && <span className="rounded-full bg-heart px-2 text-[12px] font-bold text-white">{teamUnread}</span>}
      </Link>
      <div className="mb-4 flex gap-2">
        {[["", "Open", all.filter((c) => c.status === "open").length], ["closed", "Closed", all.filter((c) => c.status === "closed").length]].map(([k, l, n]) => (
          <a key={String(k)} href={k ? `/a/chats?f=${k}` : "/a/chats"} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${(k === "closed") === closed ? "bg-ink text-white" : "border border-line bg-white"}`}>{l} <span className="opacity-70">{n}</span></a>
        ))}
      </div>
      {chats.length ? (
        <ul className="panel divide-y divide-line">
          {chats.map((c) => <ChatListRow key={c.id} chat={c} href={`/a/chats/${c.id}`} unread={chatUnread(c, "admin")} who={`${c.client_name || "Client"}, ${c.trainer_name || "no trainer"}`} flag={!c.client_user_id ? "No client email" : !c.invited_at ? "Not invited" : undefined} />)}
        </ul>
      ) : <Empty title={closed ? "No closed chats." : "No chats yet."}>{closed ? "" : "A chat is created for each new booking, or start one from a booking on the trainer's page."}</Empty>}
    </>
  );
}
