import Link from "next/link";
import { Banknote, BriefcaseBusiness, Camera, ClipboardCheck, ExternalLink, MessageCircle, MessagesSquare, PawPrint, Syringe, TriangleAlert, Users, Wallet } from "lucide-react";
import type { TodoGroup, TodoIcon, TodoItem } from "@/lib/todo";
import type { Todo } from "@/lib/reports";
import { TodoRow } from "@/components/ReportBits";
import { QuietChatButton } from "@/components/QuietChatButton";
import { TodoTypes } from "@/components/TodoTypes";
import { TodoDone } from "@/components/TodoDone";
import { IconTile } from "@/components/ui";

const GROUPS: { key: TodoGroup; title: string; short: string; hint: string }[] = [
  { key: "now", title: "Now", short: "Now", hint: "Clients waiting, money, dogs about to start" },
  { key: "week", title: "This week", short: "This week", hint: "Forms to check and follow-ups" },
  { key: "later", title: "When you have a minute", short: "Later", hint: "" }
];
const ICONS: Record<TodoIcon, typeof PawPrint> = {
  chat: MessagesSquare, vaccine: Syringe, form: ClipboardCheck, money: Banknote, alert: TriangleAlert, dog: PawPrint,
  message: MessageCircle, people: Users, pay: Wallet, deal: BriefcaseBusiness, camera: Camera
};
function ago(iso?: string) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}

/** The admin To do list. Mobile first: icon, sentence, details, then the buttons on their own line. */
export function TodoList({ items, late, beforeApp = [], canQuiet = false }: { items: TodoItem[]; late: (Todo & { trainerName?: string })[]; beforeApp?: (Todo & { trainerName?: string })[]; canQuiet?: boolean }) {
  const forms = (late.length ? 1 : 0) + (beforeApp.length ? 1 : 0); // each is one row in "This week"
  const counts = GROUPS.map((g) => ({ ...g, n: items.filter((i) => i.group === g.key).length + (g.key === "week" ? forms : 0) })).filter((g) => g.n);
  return (
    <>
      <div id="todo-list">
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <TodoTypes />
        {counts.length > 1 && <nav className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1" aria-label="Jump to">
          {counts.map((g) => <a key={g.key} href={`#todo-${g.key}`} className={`chip shrink-0 ${g.key === "now" ? "border-heart/30 text-heart" : ""}`}>{g.short}<span className="count">{g.n}</span></a>)}
        </nav>}
      </div>
      {GROUPS.map((g) => {
        const list = items.filter((i) => i.group === g.key);
        const showLate = g.key === "week" && late.length > 0, showOld = g.key === "week" && beforeApp.length > 0;
        if (!list.length && !showLate && !showOld) return null;
        return (
          <section key={g.key} id={`todo-${g.key}`} data-group={g.key} className="scroll-mt-20">
            <h2 className="group-title">{g.title}<span className="count">{list.length + (showLate ? 1 : 0) + (showOld ? 1 : 0)}</span></h2>
            {g.hint && <p className="-mt-1.5 mb-2.5 px-1 text-small text-ink-faint">{g.hint}</p>}
            <ul className="panel divide-y divide-line overflow-hidden">
              {list.map((i) => <Item key={i.key} i={i} canQuiet={canQuiet} />)}
              {showLate && <FormGroup title={`${late.length} form${late.length > 1 ? "s are" : " is"} late`} list={late}
                note={<>Trainers get reminders. Use &ldquo;Not needed&rdquo; for forms that shouldn&apos;t exist.</>} />}
              {showOld && <FormGroup title={`${beforeApp.length} handover report${beforeApp.length > 1 ? "s" : ""} from before the app`} list={beforeApp}
                note={<>Needed for the client&apos;s certificate and report. If it already went out the old way, press &ldquo;Not needed&rdquo;.</>} />}
            </ul>
          </section>
        );
      })}
      </div>
    </>
  );
}

/** A list of forms folded into one To do row. */
function FormGroup({ title, list, note }: { title: string; list: (Todo & { trainerName?: string })[]; note: React.ReactNode }) {
  return (
    <li data-kind="form">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <IconTile tone="biscuit"><ClipboardCheck size={19} /></IconTile>
          <span className="min-w-0 flex-1 font-bold">{title}</span>
          <span className="btn-ghost h-9 min-h-0 px-3 text-small group-open:hidden">Show</span>
          <span className="btn-ghost hidden h-9 min-h-0 px-3 text-small group-open:inline-flex">Hide</span>
        </summary>
        <ul className="divide-y divide-line border-t border-line bg-canvas/60">{list.map((t) => <TodoRow key={`${t.booking.id}-${t.window.kind}-${t.window.week}`} t={t} mode="admin" />)}</ul>
        <p className="border-t border-line px-4 py-2.5 text-caption text-ink-faint">{note}</p>
      </details>
    </li>
  );
}

function Item({ i, canQuiet = false }: { i: TodoItem; canQuiet?: boolean }) {
  const I = ICONS[i.icon || "alert"];
  const tone = i.tone === "heart" ? "heart" : i.tone === "biscuit" ? "biscuit" : "paper";
  return (
    <li className="flex gap-3 p-4" data-kind={i.icon || "alert"}>
      <IconTile tone={tone}><I size={19} /></IconTile>
      <div className="min-w-0 flex-1">
        <p className="font-bold leading-snug">{i.text}</p>
        {i.detail && <p className="mt-1 line-clamp-3 text-body leading-snug text-ink-soft">{i.detail}</p>}
        {i.since && <p className="mt-1 text-caption text-ink-faint">{ago(i.since)}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {i.primary && (i.primary.external
            ? <a href={i.primary.href} target="_blank" rel="noopener" className="btn-ink h-9 min-h-0 px-3.5 text-small">{i.primary.label}<ExternalLink size={13} /></a>
            : <Link prefetch={false} href={i.primary.href} className="btn-ink h-9 min-h-0 px-3.5 text-small">{i.primary.label}</Link>)}
          {i.dogHref && i.primary?.href !== i.dogHref && <Link prefetch={false} href={i.dogHref} className="btn-ghost h-9 min-h-0 px-3 text-small"><PawPrint size={14} />Dog</Link>}
          {i.hubspot && !i.primary?.external && <a href={i.hubspot} target="_blank" rel="noopener" className="btn-ghost h-9 min-h-0 px-3 text-small">HubSpot<ExternalLink size={13} /></a>}
          {canQuiet && i.quietChatId && <QuietChatButton chatId={i.quietChatId} quiet={false} />}
          {i.incidentId && <span className="ml-auto"><TodoDone id={i.incidentId} label={i.doneLabel} /></span>}
        </div>
      </div>
    </li>
  );
}
