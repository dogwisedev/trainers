import Link from "next/link";
import { Pill } from "@/components/ui";
import { Todo, kindName } from "@/lib/reports";
import { WaiveButton } from "@/components/WaiveButton";

const when = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
export const todoLabel = (t: Todo) => kindName(t.window.kind);

export function TodoPill({ t }: { t: Todo }) {
  if (t.state === "changes") return <Pill tone="biscuit">Sent back</Pill>;
  if (t.state === "overdue") return <Pill tone="heart">{t.daysLate} day{t.daysLate > 1 ? "s" : ""} late</Pill>;
  if (t.state === "waiting") return <Pill tone="line">With the team</Pill>;
  return <Pill tone={t.state === "draft" ? "biscuit" : "mint"}>{t.state === "draft" ? "Draft, " : ""}due {when(t.window.deadline)}</Pill>;
}

export function TodoRow({ t, mode }: { t: Todo & { trainerName?: string }; mode: "trainer" | "admin" }) {
  const q = `booking=${t.booking.id}&kind=${t.window.kind}&week=${t.window.week}`;
  const href = t.report?.id ? `/${mode === "admin" ? "a" : "t"}/reports/${t.report.id}` : `/${mode === "admin" ? "a" : "t"}/reports/new?${q}`;
  const verb = t.state === "changes" ? "Fix" : t.state === "draft" ? "Continue" : mode === "admin" ? "Fill in" : "Start";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5">
      <div className="min-w-[55%] flex-1">
        <p className="truncate font-bold">{t.booking.dog_name || "Dog"} <span className="font-normal text-ink-soft">{todoLabel(t)}</span></p>
        <p className="truncate text-[13px] text-ink-soft">{mode === "admin" && t.trainerName ? `${t.trainerName}, ` : ""}{t.booking.client_name}</p>
      </div>
      <TodoPill t={t} />
      {mode === "admin" && t.state !== "waiting" && <WaiveButton bookingId={t.booking.id} kind={t.window.kind} week={t.window.week} reportId={t.report?.id} />}
      {t.state !== "waiting" && <Link href={href} className="btn-ink h-9 min-h-0 px-3 text-[13px]">{verb}</Link>}
    </li>
  );
}
