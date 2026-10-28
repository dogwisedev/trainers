import Link from "next/link";
import { Plus } from "lucide-react";
import { requireRole } from "@/lib/data";
import { buildTodo, todoTotal } from "@/lib/todo";
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
  const total = todoTotal({ items, late });
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 font-extrabold leading-tight md:text-display">To do</h1>
          <p className="mt-1 text-ink-soft">{total ? `${total} thing${total > 1 ? "s" : ""} need a person. Most urgent first.` : "Nothing needs you right now."}</p>
        </div>
        <div className="flex gap-2">
          {v.email && LOG_VIEWERS().includes(v.email.toLowerCase()) && <Link prefetch={false} href="/a/log" className="btn-ghost h-10 min-h-0 shrink-0 px-3.5 text-body">Activity log</Link>}
          <Link prefetch={false} href="/a/bookings/new" className="btn-ink h-10 min-h-0 shrink-0 px-3.5 text-body"><Plus size={17} />Book a dog</Link>
        </div>
      </div>
      {!total && <div className="mt-6"><Empty title="All done.">New things show up here as they happen: clients waiting, forms to check, vaccines, payslips.</Empty></div>}
      <TodoList items={items} late={late} />
    </>
  );
}

