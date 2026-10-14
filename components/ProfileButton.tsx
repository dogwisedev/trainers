import Link from "next/link";
import { ClipboardList } from "lucide-react";

/** "Dog profile" next to the chat: the before-training checklist and the client's answers. */
export function ProfileButton({ href, left }: { href: string; left: number | null }) {
  return (
    <Link href={href} className="btn-ghost h-9 min-h-0 shrink-0 px-3 text-[13px]">
      <ClipboardList size={15} />Dog profile
      {left !== null && (left > 0 ? <span className="rounded-full bg-heart px-1.5 text-[11px] font-bold text-white">{left}</span> : <span className="text-[11px] font-bold text-fern">Ready</span>)}
    </Link>
  );
}
