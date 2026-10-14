import Link from "next/link";
import { ExternalLink, Plus } from "lucide-react";
import { requireRole } from "@/lib/data";
import { buildTodo, TodoGroup, TodoItem } from "@/lib/todo";
import { currentRunDate, getRun } from "@/lib/payrollData";
import { isPayMonday, periodLabel, runDates } from "@/lib/payroll";
import { todayIso } from "@/lib/dates";
import { isDemo } from "@/lib/supabase";
import { TodoRow } from "@/components/ReportBits";
import { TodoDone } from "@/components/TodoDone";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const GROUPS: { key: TodoGroup; title: string; hint: string }[] = [
  { key: "now", title: "Now", hint: "Clients waiting, money, dogs about to start" },
  { key: "week", title: "This week", hint: "Forms to review, follow-ups" },
  { key: "later", title: "When you have a minute", hint: "" }
];
function ago(iso?: string) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}

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
        items.push({ key: "pay", group: isPayMonday(todayIso()) ? "now" : "week", tone: "biscuit", text: `${drafts} payslip${drafts > 1 ? "s" : ""} to approve`, detail: periodLabel(d.period_start, d.period_end), primary: { label: "Open payslips", href: "/a/trainers?view=pay" } });
      }
    } catch { /* payroll not set up: nothing to show */ }
  }
  const total = items.length + (late.length ? 1 : 0);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-extrabold md:text-[38px]">To do</h1>
          <p className="mt-1 text-ink-soft">{total ? `${total} thing${total > 1 ? "s" : ""} need a person. Most urgent first.` : "Nothing needs you right now."}</p>
        </div>
        <Link href="/a/bookings/new" className="btn-ink h-10 min-h-0 px-4"><Plus size={17} />Book a dog</Link>
      </div>
      {!total && <div className="mt-6"><Empty title="All done.">New things show up here as they happen: clients waiting, forms to check, vaccines, payslips.</Empty></div>}
      {GROUPS.map((g) => {
        const list = items.filter((i) => i.group === g.key);
        const showLate = g.key === "week" && late.length > 0;
        if (!list.length && !showLate) return null;
        return (
          <section key={g.key} className="mt-7">
            <h2 className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide text-ink-soft">{g.title} <span className="opacity-70">{list.length + (showLate ? 1 : 0)}</span>{g.hint && <span className="ml-2 font-normal normal-case tracking-normal text-ink-faint">{g.hint}</span>}</h2>
            <ul className="panel divide-y divide-line">
              {list.map((i) => <Item key={i.key} i={i} />)}
              {showLate && (
                <li className="p-3.5">
                  <details>
                    <summary className="flex cursor-pointer list-none items-center gap-3">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-biscuit" />
                      <span className="min-w-0 flex-1 font-semibold">{late.length} form{late.length > 1 ? "s are" : " is"} late</span>
                      <span className="btn-ghost h-9 min-h-0 px-3 text-[13px]">Show</span>
                    </summary>
                    <ul className="mt-2 divide-y divide-line rounded-xl border border-line">{late.map((t) => <TodoRow key={`${t.booking.id}-${t.window.kind}-${t.window.week}`} t={t} mode="admin" />)}</ul>
                    <p className="mt-2 text-[12px] text-ink-faint">Trainers get reminders. Use &ldquo;Not needed&rdquo; for forms that shouldn&apos;t exist.</p>
                  </details>
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function Item({ i }: { i: TodoItem }) {
  const dot = { heart: "bg-heart", biscuit: "bg-biscuit", line: "bg-line" }[i.tone];
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{i.text}</p>
        {(i.detail || i.since) && <p className="text-[13px] text-ink-soft">{i.detail}{i.detail && i.since ? " · " : ""}{i.since && <span className="text-ink-faint">{ago(i.since)}</span>}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {i.primary && (i.primary.external
          ? <a href={i.primary.href} target="_blank" rel="noopener" className="btn-ink h-9 min-h-0 px-3 text-[13px]">{i.primary.label}<ExternalLink size={13} /></a>
          : <Link href={i.primary.href} className="btn-ink h-9 min-h-0 px-3 text-[13px]">{i.primary.label}</Link>)}
        {i.dogHref && i.primary?.href !== i.dogHref && <Link href={i.dogHref} className="btn-ghost h-9 min-h-0 px-3 text-[13px]">Dog</Link>}
        {i.hubspot && !i.primary?.external && <a href={i.hubspot} target="_blank" rel="noopener" className="btn-ghost h-9 min-h-0 px-3 text-[13px]">HubSpot<ExternalLink size={13} /></a>}
        {i.incidentId && <TodoDone id={i.incidentId} />}
      </div>
    </li>
  );
}
