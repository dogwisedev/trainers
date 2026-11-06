import Link from "next/link";
import { Camera, Check, ChevronRight, MessageCircle } from "lucide-react";
import { IconTile } from "@/components/ui";
import { TodoRowCompact } from "@/components/ReportBits";
import type { Todo } from "@/lib/reports";
import type { TrainerToday } from "@/lib/trainerToday";

const waited = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] || "");

/** Today's to do for a trainer: clients waiting on them, dogs that still need today's update, and forms.
 *  Every row opens the exact chat or form, and drops off by itself once it's done. Phone first: whole rows are the buttons. */
export function TrainerTodo({ today, forms }: { today: TrainerToday; forms: Todo[] }) {
  const { waiting, updates, posted, cutoff } = today;
  const left = waiting.length + updates.length + forms.length;
  if (!left && !posted.length) return null;
  return (
    <section className="panel mb-4 overflow-hidden" aria-label="To do today" data-tour="todo">
      <div className="flex items-baseline justify-between gap-3 border-b border-line bg-paper/60 px-4 py-3">
        <h2 className="text-lead font-extrabold">{left ? "To do today" : "All done for today"}</h2>
        {left > 0 && <span className="text-small font-semibold text-ink-soft">{left} left</span>}
      </div>
      {left > 0 && (
        <ul className="divide-y divide-line">
          {waiting.map((w) => (
            <li key={`w${w.chatId}`}>
              <Link prefetch={false} href={`/t/chats/${w.chatId}`} aria-label={`Reply to ${w.client}`} className="flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-paper/60">
                <IconTile tone="heart"><MessageCircle size={19} /></IconTile>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold leading-snug">{w.client} is waiting for you <span className="font-semibold text-heart">· {waited(w.since)}</span></span>
                  <span className="mt-0.5 line-clamp-2 block text-body leading-snug text-ink-soft">{w.dog}: {w.said.startsWith("Sent a") ? w.said : <>&ldquo;{w.said}&rdquo;</>}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-ink-faint" aria-hidden />
              </Link>
            </li>
          ))}
          {updates.map((u) => (
            <li key={`u${u.chatId}`}>
              <Link prefetch={false} href={`/t/chats/${u.chatId}`} className="flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-paper/60">
                <IconTile tone="biscuit"><Camera size={19} /></IconTile>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold leading-snug">Post today&apos;s update: {u.dog}</span>
                  <span className="mt-0.5 block text-body leading-snug text-ink-soft">{u.client} gets a photo or video every day, by {cutoff}.</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-ink-faint" aria-hidden />
              </Link>
            </li>
          ))}
          {forms.slice(0, 5).map((x) => <TodoRowCompact key={`${x.booking.id}${x.window.kind}${x.window.week}`} t={x} />)}
          {forms.length > 5 && <li className="px-4 py-2.5 text-small text-ink-soft">And {forms.length - 5} more in <Link prefetch={false} href="/t/reports" className="underline">Forms</Link>.</li>}
        </ul>
      )}
      {posted.length > 0 && (
        <p className={`flex items-start gap-1.5 px-4 py-2.5 text-small font-semibold text-fern ${left ? "border-t border-line" : ""}`}>
          <Check size={16} className="mt-0.5 shrink-0" aria-hidden />Posted today: {list(posted)}
        </p>
      )}
    </section>
  );
}
