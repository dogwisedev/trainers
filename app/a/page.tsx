import Link from "next/link";
import { Plus } from "lucide-react";
import { requireRole } from "@/lib/data";
import { buildTodo } from "@/lib/todo";
import { LOG_VIEWERS } from "@/lib/audit";
import { isPayMonday, periodLabel } from "@/lib/payroll";
import { todayIso } from "@/lib/dates";
import { isDemo, serviceClient } from "@/lib/supabase";
import { TodoList } from "@/components/TodoList";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Admin home: one list of everything that needs a person, most urgent first. Each line has one obvious button.
export default async function ToDo() {
  const v = await requireRole("admin");
  const { items, late } = await buildTodo();
  // Payslips waiting for approval: one small count, not the whole pay run
  if (!isDemo()) {
    const { data: drafts } = await serviceClient().from("payslips").select("id, pay_runs(submit_date, period_start, period_end)").eq("status", "draft").limit(200);
    const list = (drafts || []) as unknown as { pay_runs: { submit_date: string; period_start: string; period_end: string } | null }[];
    if (list.length) {
      const r = list.map((x) => x.pay_runs).filter(Boolean).sort((a, b) => a!.submit_date.localeCompare(b!.submit_date))[0];
      items.push({ key: "pay", group: isPayMonday(todayIso()) ? "now" : "week", tone: "biscuit", icon: "pay", text: `${list.length} payslip${list.length > 1 ? "s" : ""} to approve`, detail: r ? periodLabel(r.period_start, r.period_end) : undefined, primary: { label: "Open payslips", href: "/a/trainers?view=pay" } });
    }
  }
  const total = items.length + (late.length ? 1 : 0);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-extrabold leading-tight md:text-[38px]">To do</h1>
          <p className="mt-1 text-ink-soft">{total ? `${total} thing${total > 1 ? "s" : ""} need a person. Most urgent first.` : "Nothing needs you right now."}</p>
        </div>
        <div className="flex gap-2">
          {v.email && LOG_VIEWERS().includes(v.email.toLowerCase()) && <Link prefetch={false} href="/a/log" className="btn-ghost h-10 min-h-0 shrink-0 px-3.5 text-[14px]">Activity log</Link>}
          <Link prefetch={false} href="/a/bookings/new" className="btn-ink h-10 min-h-0 shrink-0 px-3.5 text-[14px]"><Plus size={17} />Book a dog</Link>
        </div>
      </div>
      {!total && <div className="mt-6"><Empty title="All done.">New things show up here as they happen: clients waiting, forms to check, vaccines, payslips.</Empty></div>}
      <TodoList items={items} late={late} />
    </>
  );
}

