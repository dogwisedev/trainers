import Link from "next/link";
import { requireRole, unreadForTrainer } from "@/lib/data";
import { chatReads, listChats } from "@/lib/chatData";
import { chatUnread } from "@/lib/chatTypes";
import { ChatListRow } from "@/components/ChatBits";
import { Empty } from "@/components/ui";

export default async function TrainerChats() {
  const v = await requireRole("trainer");
  const [chats, reads, team] = await Promise.all([listChats(), chatReads(v.userId), v.trainerId ? unreadForTrainer(v.trainerId) : 0]);
  const mine = chats.filter((c) => c.trainer_id === v.trainerId && c.status === "open");
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Chats</h1>
      <p className="mb-4 mt-1 text-ink-soft">Message each client about their dog. Share a photo or video update at least once a day.</p>
      <ul className="panel divide-y divide-line">
        <li>
          <Link href="/t/messages" className="flex items-center gap-3 p-3.5 hover:bg-mint-wash">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${team ? "bg-heart" : "bg-transparent"}`} />
            <div className="min-w-0 flex-1"><p className="font-bold">Dogwise team</p><p className="text-[13px] text-ink-soft">Questions about a dog, pickups or your calendar</p></div>
          </Link>
        </li>
        {mine.map((c) => <ChatListRow key={c.id} chat={c} href={`/t/chats/${c.id}`} unread={chatUnread(c, "trainer", reads[c.id])} who={c.client_name || "Client"} />)}
      </ul>
      {mine.length === 0 && <div className="mt-4"><Empty title="No client chats yet.">One appears here when a dog is booked with you.</Empty></div>}
    </>
  );
}
