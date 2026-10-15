import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { getChat, listChatMessages } from "@/lib/chatData";
import { isDemo } from "@/lib/supabase";
import { ChatThread } from "@/components/ChatThread";
import { ArchivedNotice } from "@/components/ChatBits";
import { ProfileButton } from "@/components/ProfileButton";
import { chatReadiness } from "@/lib/pretraining";

export default async function TrainerChat({ params }: { params: { id: string } }) {
  const v = await requireRole("trainer");
  const chat = await getChat(params.id);
  if (!chat || chat.trainer_id !== v.trainerId) notFound();
  const [{ messages, hasMore }, ready] = await Promise.all([listChatMessages(chat.id), chatReadiness(chat.deal_key, false)]);
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/t/chats" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="All chats"><ChevronLeft /></Link>
        <div className="min-w-0 flex-1"><h1 className="truncate text-[24px] font-extrabold leading-tight">{chat.title || "Dog"}</h1><p className="truncate text-[14px] text-ink-soft">{chat.client_name}</p></div>
        {/^\d+$/.test(chat.deal_key) && <ProfileButton href={`/t/chats/${chat.id}/profile`} left={ready ? ready.left : null} />}
        {chat.status === "open" && <Link href={`/t/chats/${chat.id}/incident`} className="btn-ghost h-9 min-h-0 shrink-0 px-3 text-[13px] text-heart"><TriangleAlert size={15} />Report incident</Link>}
      </div>
      {chat.archived_at ? <ArchivedNotice chat={chat} audience="staff" /> : <ChatThread chatId={chat.id} me={{ userId: v.userId, role: "trainer", name: v.name }} initial={messages} hasMore={hasMore} open={chat.status === "open"} folderUrl={chat.drive_folder_url} demo={isDemo()} withBottomNav otherLabel={`${chat.client_name || "the client"} and the Dogwise team`} />}
    </>
  );
}
