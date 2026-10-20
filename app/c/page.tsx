import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/data";
import { chatReads, listChats } from "@/lib/chatData";
import { chatUnread } from "@/lib/chatTypes";
import { ChatListRow } from "@/components/ChatBits";
import { ReopenChat } from "@/components/ChatActions";

export default async function ClientHome() {
  const v = await requireRole("client");
  const chats = (await listChats()).filter((c) => c.client_user_id === v.userId);
  const open = chats.filter((c) => c.status === "open");
  if (open.length === 1) redirect(`/c/${open[0].id}`);
  const closed = chats.filter((c) => c.status === "closed");
  const reads = await chatReads(v.userId);
  return (
    <>
      <h1 className="text-[28px] font-extrabold">Your chats</h1>
      {chats.length ? (
        <ul className="panel mt-4 divide-y divide-line">
          {chats.map((c) => <ChatListRow key={c.id} chat={c} href={`/c/${c.id}`} unread={chatUnread(c, "client", reads[c.id])} who={c.trainer_name || ""} />)}
        </ul>
      ) : null}
      {open.length === 0 && closed.length > 0 && (
        <div className="panel mt-4 space-y-3 p-5">
          <p className="font-bold">Need us again?</p>
          <p className="text-[14px] text-ink-soft">Your earlier chat is closed and saved. Start a new one any time, and the Dogwise team will pick it up.</p>
          <ReopenChat chatId={closed[0].id} base="/c" />
        </div>
      )}
      {chats.length === 0 && <p className="mt-4 rounded-2xl border border-dashed border-line bg-white p-6 text-center text-ink-soft">You don&apos;t have an open chat right now. When your dog&apos;s training starts, it will appear here. Questions? Email <Link prefetch={false} className="underline" href="mailto:info@dogwiseacademy.com">info@dogwiseacademy.com</Link>.</p>}
    </>
  );
}
