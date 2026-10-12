import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { getChat, listChatMessages } from "@/lib/chatData";
import { isDemo } from "@/lib/supabase";
import { ChatThread } from "@/components/ChatThread";

export default async function TrainerChat({ params }: { params: { id: string } }) {
  const v = await requireRole("trainer");
  const chat = await getChat(params.id);
  if (!chat || chat.trainer_id !== v.trainerId) notFound();
  const { messages, hasMore } = await listChatMessages(chat.id);
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/t/chats" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="All chats"><ChevronLeft /></Link>
        <div className="min-w-0"><h1 className="truncate text-[24px] font-extrabold leading-tight">{chat.title || "Dog"}</h1><p className="truncate text-[14px] text-ink-soft">{chat.client_name}</p></div>
      </div>
      <ChatThread chatId={chat.id} me={{ userId: v.userId, role: "trainer", name: v.name }} initial={messages} hasMore={hasMore} open={chat.status === "open"} folderUrl={chat.drive_folder_url} demo={isDemo()} withBottomNav otherLabel={`${chat.client_name || "the client"} and the Dogwise team`} />
    </>
  );
}
