import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { serviceClient } from "@/lib/supabase";

/** Dogs → Not booked: deals won in HubSpot with no booking in the app yet. Each opens a page with what the client has
 *  already told us (their before-training answers), so the office can read it before choosing a trainer. */
export async function NotBookedList({ q }: { q: string }) {
  const { data } = await serviceClient().from("chat_incidents").select("id, title, detail, ref, opened_at").eq("kind", "deal_not_booked").neq("status", "resolved").order("opened_at", { ascending: false }).limit(200);
  const rows = ((data || []) as { id: string; title: string | null; detail: string | null; ref: string | null; opened_at: string }[])
    .filter((r) => !q || `${r.title} ${r.detail}`.toLowerCase().includes(q.toLowerCase()));
  if (!rows.length) return <p className="panel p-5 text-ink-soft">{q ? "No unbooked deal matches." : "Every Closed Won deal is booked. Nothing waiting."}</p>;
  const days = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5));
  return (
    <ul className="panel divide-y divide-line">
      {rows.map((r) => { const id = (r.ref || "").replace(/^deal:/, ""); return (
        <li key={r.id}>
          <Link prefetch={false} href={`/a/deals/${id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper/60">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-biscuit" aria-hidden />
            <span className="min-w-0 flex-1"><span className="block font-bold">{r.title || `Deal ${id}`}</span><span className="block text-small text-ink-soft">{(r.detail || "").replace(/^.*?: /, "")}</span><span className="block text-caption text-ink-faint">Waiting {days(r.opened_at)} day{days(r.opened_at) === 1 ? "" : "s"} to be booked</span></span>
            <ChevronRight size={18} className="shrink-0 text-ink-faint" aria-hidden />
          </Link>
        </li>); })}
    </ul>
  );
}
