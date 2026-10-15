import Link from "next/link";
import { Plus } from "lucide-react";
import { requireRole } from "@/lib/data";
import { buildTodo } from "@/lib/todo";
import { currentRunDate, getRun } from "@/lib/payrollData";
import { isPayMonday, periodLabel, runDates } from "@/lib/payroll";
import { todayIso } from "@/lib/dates";
import { isDemo } from "@/lib/supabase";
import { TodoList } from "@/components/TodoList";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Admin home: one list of everything that needs a person, most urgent first. Each line has one obvious button.
export default async function ToDo() {
  await requireRole("admin");
  const { items, late } = await buildTodo();
  // Payslips waiting for approval
  if (!isDemo()) {
    try {
      const run = await currentRunDate(), pay = await getRun(run), drafts = pay.slips.filter((s) => s.status === "draft").length;
      if (drafts) {
        const d = runDates(run);
        items.push({ key: "pay", group: isPayMonday(todayIso()) ? "now" : "week", tone: "biscuit", icon: "pay", text: `${drafts} payslip${drafts > 1 ? "s" : ""} to approve`, detail: periodLabel(d.period_start, d.period_end), primary: { label: "Open payslips", href: "/a/trainers?view=pay" } });
      }
    } catch { /* payroll not set up: nothing to show */ }
  }
  const total = items.length + (late.length ? 1 : 0);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-extrabold leading-tight md:text-[38px]">To do</h1>
          <p className="mt-1 text-ink-soft">{total ? `${total} thing${total > 1 ? "s" : ""} need a person. Most urgent first.` : "Nothing needs you right now."}</p>
        </div>
        <Link href="/a/bookings/new" className="btn-ink h-10 min-h-0 shrink-0 px-3.5 text-[14px]"><Plus size={17} />Book a dog</Link>
      </div>
      {!total && <div className="mt-6"><Empty title="All done.">New things show up here as they happen: clients waiting, forms to check, vaccines, payslips.</Empty></div>}
      <TodoList items={items} late={late} />
    </>
  );
}

