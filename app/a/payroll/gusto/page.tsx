import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { periodLabel, usDate } from "@/lib/payroll";
import { GustoFill } from "@/components/GustoFill";

export const dynamic = "force-dynamic";
/** Surname for sorting, like Gusto: the last word, ignoring nicknames in quotes ("Nyeem \"Cal\" Calhoun" → Calhoun). */
const surname = (name: string) => { const w = name.replace(/["“”'][^"“”']*["“”']/g, " ").trim().split(/\s+/); return (w[w.length - 1] || name).toLowerCase(); };

// Admin: the approved payslips of one pay run, A-Z by surname like Gusto's "Pay contractors" list, to type into "Flat amount".
export default async function Gusto({ searchParams }: { searchParams: { run?: string } }) {
  await requireRole("admin");
  if (isDemo()) return <p className="panel p-6">Not available in demo mode.</p>;
  const sb = serviceClient();
  const { data: run } = searchParams.run ? await sb.from("pay_runs").select("*").eq("submit_date", searchParams.run).maybeSingle() : { data: null };
  if (!run) return <p className="panel p-6">Pay run not found.</p>;
  const { data: slips } = await sb.from("payslips").select("id, status, total, trainer_id, trainer_name, trainers(name, gusto_code)").eq("pay_run_id", run.id);
  const all = ((slips || []) as unknown as { id: string; status: string; total: number; trainer_id: string; trainer_name: string | null; trainers: { name: string; gusto_code: string | null } | null }[])
    .map((x) => ({ id: x.id, trainerId: x.trainer_id, code: x.trainers?.gusto_code || null, name: x.trainers?.name || x.trainer_name || "?", total: Number(x.total || 0), approved: x.status === "approved" }));
  const approved = all.filter((x) => x.approved && x.total !== 0).sort((a, b) => surname(a.name).localeCompare(surname(b.name)) || a.name.localeCompare(b.name));
  const pending = all.filter((x) => !x.approved).length;
  const [{ data: payees }, { data: trs }] = await Promise.all([
    sb.from("gusto_payees").select("code, first_name, last_name, business_name"),
    sb.from("trainers").select("id, name, gusto_code").eq("active", true).order("name")
  ]);
  const inRun = new Set(approved.map((x) => x.trainerId));
  const others = ((trs || []) as { id: string; name: string; gusto_code: string | null }[]).filter((t) => !inRun.has(t.id)).map((t) => ({ trainerId: t.id, name: t.name, amount: 0, code: t.gusto_code }));
  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <Link prefetch={false} href="/a/trainers?view=pay" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back"><ChevronLeft /></Link>
        <h1 className="text-[28px] font-extrabold leading-tight">Gusto list</h1>
      </div>
      <p className="mb-4 text-ink-soft">{periodLabel(run.period_start, run.period_end)}, paid Fri {usDate(run.paid_date)}. Approved payslips only, sorted by surname like Gusto.</p>
      <GustoFill run={run.submit_date} pay={approved.map((x) => ({ trainerId: x.trainerId, name: x.name, amount: x.total, code: x.code }))} others={others} payees={((payees || []) as { code: string; first_name: string | null; last_name: string | null; business_name: string | null }[]).map((p) => ({ code: p.code, first: p.first_name || "", last: p.last_name || "", business: p.business_name || "" }))} paidAt={run.gusto_paid_at} paidBy={run.gusto_paid_by} pending={pending} />
    </>
  );
}
