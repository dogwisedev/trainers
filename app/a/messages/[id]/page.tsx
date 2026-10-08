import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getTrainer, listMessages, requireRole } from "@/lib/data";
import { MessageThread } from "@/components/MessageThread";
import { Avatar } from "@/components/ui";

export default async function AdminThread({ params }: { params: { id: string } }) {
  await requireRole("admin");
  const t = await getTrainer(params.id);
  if (!t) notFound();
  const msgs = await listMessages(t.id);
  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <Link href="/a/messages" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="All messages"><ChevronLeft /></Link>
        <Avatar name={t.name} size={40} />
        <div><Link href={`/a/trainers/${t.id}`} className="font-bold hover:underline">{t.name}</Link><p className="text-[13px] text-ink-soft">{[t.city, t.state].filter(Boolean).join(", ")}</p></div>
      </div>
      <MessageThread trainerId={t.id} initial={msgs} me="admin" otherName={t.name.split(" ")[0]} />
    </>
  );
}
