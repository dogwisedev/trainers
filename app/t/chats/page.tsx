import Link from "next/link";
import Image from "next/image";
import { requireRole, unreadForTrainer } from "@/lib/data";
import { chatReads, chatSpans, listChats, searchChatMessages } from "@/lib/chatData";
import { chatUnread } from "@/lib/chatTypes";
import { datesLabel, groupChats, groupWithUnread, nameMatches, orderChats } from "@/lib/chatOrder";
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
      <h1 className="text-h1 font-extrabold">Chats</h1>
      <p className="mb-4 mt-1 text-ink-soft">Message each client about their dog. Share a photo or video update at least once a day.</p>
      <ul className="panel mb-4 divide-y divide-line">
        <li>
          <Link prefetch={false} href="/t/messages" data-tour="team" className="flex items-center gap-3 px-3.5 py-3 hover:bg-paper/60">
            <span className="relative grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-ink" aria-hidden>
              <Image src="/icons/mark.png" alt="" width={24} height={24} className="brightness-0 invert" />
              {team > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-heart" />}
            </span>
            <div className="min-w-0 flex-1"><p className="font-bold">Dogwise team</p><p className="text-small text-ink-soft">Questions about a dog, pickups or your calendar</p></div>
          </Link>
        </li>
      </ul>
      {mine.length > 0 && <ChatFilters base="/t/chats" q={q} />}
      {groupWithUnread(placed, (c) => chatUnread(c, "trainer", reads[c.id])).map((g) => (
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
