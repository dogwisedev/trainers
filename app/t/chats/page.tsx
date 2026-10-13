import Link from "next/link";
import { requireRole, unreadForTrainer } from "@/lib/data";
import { chatReads, chatSpans, listChats, searchChatMessages } from "@/lib/chatData";
import { chatUnread } from "@/lib/chatTypes";
import { datesLabel, groupChats, nameMatches, orderChats } from "@/lib/chatOrder";
import { etParts } from "@/lib/chatRules";
import { ChatGroupTitle, ChatListRow } from "@/components/ChatBits";
import { ChatFilters } from "@/components/ChatFilters";
import { Empty } from "@/components/ui";

export default async function TrainerChats({ searchParams }: { searchParams: { q?: string } }) {
  const v = await requireRole("trainer");
  const q = (searchParams.q || "").trim();
  const [chats, reads, team, hits] = await Promise.all([listChats(), chatReads(v.userId), v.trainerId ? unreadForTrainer(v.trainerId) : 0, q ? searchChatMessages(q) : Promise.resolve(new Map<string, string>())]);
  const mine = chats.filter((c) => c.trainer_id === v.trainerId && c.status === "open");
  const shown = mine.filter((c) => !q || nameMatches(c, q) || hits.has(c.id));
  const placed = orderChats(shown, await chatSpans(shown.map((c) => c.deal_key)), etParts(new Date()).date);
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Chats</h1>
      <p className="mb-4 mt-1 text-ink-soft">Message each client about their dog. Share a photo or video update at least once a day.</p>
      <ul className="panel mb-4 divide-y divide-line">
        <li>
          <Link href="/t/messages" className="flex items-center gap-3 p-3.5 hover:bg-mint-wash">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${team ? "bg-heart" : "bg-transparent"}`} />
            <div className="min-w-0 flex-1"><p className="font-bold">Dogwise team</p><p className="text-[13px] text-ink-soft">Questions about a dog, pickups or your calendar</p></div>
          </Link>
        </li>
      </ul>
      {mine.length > 0 && <ChatFilters base="/t/chats" q={q} />}
      {groupChats(placed).map((g) => (
        <section key={g.group}>
          <ChatGroupTitle label={g.label} count={g.items.length} />
          <ul className="panel divide-y divide-line">
            {g.items.map((p) => <ChatListRow key={p.chat.id} chat={p.chat} href={`/t/chats/${p.chat.id}`} unread={chatUnread(p.chat, "trainer", reads[p.chat.id])} who={p.chat.client_name || "Client"} dates={datesLabel(p)} preview={hits.get(p.chat.id)} />)}
          </ul>
        </section>
      ))}
      {mine.length === 0 && <Empty title="No client chats yet.">One appears here when a dog is booked with you.</Empty>}
      {mine.length > 0 && shown.length === 0 && <Empty title="No chats match." />}
    </>
  );
}
