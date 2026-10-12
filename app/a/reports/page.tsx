import Link from "next/link";
import { requireRole } from "@/lib/data";
import { listQueue, listTodos } from "@/lib/reportData";
import { Empty, Pill } from "@/components/ui";
import { TodoRow } from "@/components/ReportBits";

type F = "pending" | "overdue" | "approved";
export default async function ReportsQueue({ searchParams }: { searchParams: { f?: string } }) {
  await requireRole("admin");
  const [queue, todos] = await Promise.all([listQueue(), listTodos()]);
  const pending = queue.filter((q) => q.status === "submitted" || q.status === "changes_requested");
  const overdue = todos.filter((t) => t.state === "overdue");
  const approved = queue.filter((q) => q.status === "approved").sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || "")).slice(0, 60);
  const f = (["pending", "overdue", "approved"].includes(searchParams.f || "") ? searchParams.f : pending.length ? "pending" : overdue.length ? "overdue" : "pending") as F;
  const tabs: [F, string, number][] = [["pending", "To review", pending.length], ["overdue", "Overdue", overdue.length], ["approved", "Sent", approved.length]];
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Reports</h1>
      <p className="mb-4 mt-1 text-ink-soft">Weekly and handover reports from trainers. Approve to send them to the client.</p>
      <div className="mb-4 flex gap-2">
        {tabs.map(([k, l, n]) => (
          <Link key={k} href={`/a/reports?f=${k}`} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${f === k ? "bg-ink text-white" : "border border-line bg-white"}`}>{l} <span className="opacity-70">{n}</span></Link>
        ))}
      </div>

      {f === "overdue" ? (
        overdue.length ? <ul className="panel divide-y divide-line">{overdue.map((t) => <TodoRow key={`${t.booking.id}${t.window.kind}${t.window.week}`} t={t} mode="admin" />)}</ul>
          : <Empty title="Nothing overdue.">Every trainer is up to date.</Empty>
      ) : (
        (() => {
          const list = f === "pending" ? pending : approved;
          return list.length ? (
            <ul className="grid gap-2.5 md:grid-cols-2">
              {list.map((r) => (
                <li key={r.id}>
                  <Link href={`/a/reports/${r.id}`} className={`panel block p-3.5 hover:border-ink-faint ${r.status === "changes_requested" ? "border-biscuit bg-biscuit-wash/50" : r.status === "approved" ? "" : "border-biscuit"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-bold">{r.dog || "Dog"} <span className="font-normal text-ink-soft">{r.kind === "weekly" ? `week ${r.week}` : "handover"}</span></p>
                      {r.status === "approved" ? (r.error ? <Pill tone="heart">Email failed</Pill> : <Pill>Sent</Pill>) : r.status === "changes_requested" ? <Pill tone="biscuit">With trainer</Pill> : <Pill tone="line">To review</Pill>}
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-soft">{r.trainer}, client {r.client}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
                      {r.submittedAt && <span className="text-ink-faint">Submitted {new Date(r.submittedAt).toLocaleDateString("en-US")}</span>}
                      {r.late > 0 && <Pill tone="heart">{r.late} day{r.late > 1 ? "s" : ""} late</Pill>}
                      {r.byAdmin && <Pill tone="line">Filled in by admin</Pill>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Empty title={f === "pending" ? "Nothing to review." : "Nothing sent yet."}>{f === "pending" ? "Submitted reports show up here." : ""}</Empty>;
        })()
      )}
    </>
  );
}
