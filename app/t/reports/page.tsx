import Link from "next/link";
import { requireRole } from "@/lib/data";
import { listMyReports, listTodos } from "@/lib/reportData";
import { Empty, Pill, Section } from "@/components/ui";
import { kindName } from "@/lib/reports";
import { TodoRow } from "@/components/ReportBits";

export default async function MyReports() {
  const v = await requireRole("trainer");
  if (!v.trainerId) return null;
  const [todos, mine] = await Promise.all([listTodos({ trainerId: v.trainerId }), listMyReports(v.trainerId)]);
  const open = todos.filter((t) => t.state !== "waiting");
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Reports</h1>
      <p className="mb-2 mt-1 text-ink-soft">Three forms for each dog: an intake form on pickup day, a weekly health check (Wednesday to Friday), and a handover report when the program ends.</p>
      <Section title="To do">
        {open.length ? <ul className="panel divide-y divide-line">{open.map((t) => <TodoRow key={`${t.booking.id}${t.window.kind}${t.window.week}`} t={t} mode="trainer" />)}</ul>
          : <Empty title="All caught up.">New reports show up here when a dog is with you.</Empty>}
      </Section>
      <Section title="Sent">
        {mine.length ? (
          <ul className="panel divide-y divide-line">
            {mine.map((r) => (
              <li key={r.id}><Link href={`/t/reports/${r.id}`} className="flex items-center gap-3 p-3.5 hover:bg-mint-wash">
                <div className="min-w-0 flex-1"><p className="truncate font-bold">{String(r.answers.dogName || "Dog")} <span className="font-normal text-ink-soft">{kindName(r.kind)}</span></p>
                  <p className="text-[13px] text-ink-soft">{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString("en-US") : ""}</p></div>
                <Pill tone={r.status === "approved" ? "mint" : r.status === "changes_requested" ? "biscuit" : "line"}>{r.status === "approved" ? (r.kind === "handover" ? "Sent to client" : "Reviewed") : r.status === "changes_requested" ? "Sent back" : "With the team"}</Pill>
              </Link></li>
            ))}
          </ul>
        ) : <p className="text-[14px] text-ink-soft">Nothing sent yet.</p>}
      </Section>
    </>
  );
}
