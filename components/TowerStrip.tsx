import Link from "next/link";
import { ChevronRight, Eye, ShieldAlert, ShieldCheck } from "lucide-react";
import { serviceClient } from "@/lib/supabase";

/** Above To do: the Tower at a glance (risk and decisions, watched dogs, QA box), one tap to the Tower page. */
export async function TowerStrip({ risk }: { risk: number }) {
  const sb = serviceClient();
  const [w, q] = await Promise.all([
    sb.from("watch_list").select("booking_id", { count: "exact", head: true }).then((r) => r.count ?? null, () => null),
    sb.from("qa_flags").select("id", { count: "exact", head: true }).in("status", ["ticked", "already", "hand"]).gte("at", new Date(Date.now() - 14 * 864e5).toISOString()).then((r) => r.count ?? null, () => null)
  ]);
  const tile = (Icon: typeof Eye, n: number | null, label: string, hot: boolean) => (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${hot ? "bg-heart-wash text-heart" : "bg-mint-wash text-fern"}`}><Icon size={17} /></span>
      <span className="min-w-0"><span className="block text-lead font-extrabold leading-none tabular-nums">{n ?? "–"}</span><span className="block truncate text-caption text-ink-soft">{label}</span></span>
    </span>
  );
  return (
    <Link prefetch={false} href="/a/tower" className="panel mt-4 flex items-center gap-3 px-4 py-3 transition hover:bg-mint-wash/50" aria-label="Open the Tower page: risk, watched dogs and the QA box">
      <span className="hidden shrink-0 pr-1 text-small font-bold text-ink-soft sm:block">Tower</span>
      <span className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-2">
        {tile(ShieldAlert, risk, "Risk and decisions", risk > 0)}
        {tile(Eye, w, "Dogs watched", false)}
        {tile(ShieldCheck, q, "QA box, 14 days", false)}
      </span>
      <ChevronRight size={18} className="shrink-0 text-ink-faint" aria-hidden />
    </Link>
  );
}
