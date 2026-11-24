import Link from "next/link";
import { Banknote, BriefcaseBusiness, Camera, ChevronDown, ClipboardCheck, ExternalLink, MessageCircle, MessagesSquare, PawPrint, Syringe, TriangleAlert, Users, Wallet } from "lucide-react";
import type { TodoIcon, TodoItem } from "@/lib/todo";
import type { Todo } from "@/lib/reports";
import { TodoRow } from "@/components/ReportBits";
import { QuietChatButton } from "@/components/QuietChatButton";
import { TodoTypes } from "@/components/TodoTypes";
import { DealDecision } from "@/components/DealDecision";
import { BookingDecision } from "@/components/BookingDecision";
import { AskDecision } from "@/components/AskDecision";
import { TodoDone } from "@/components/TodoDone";
import { ChaseActions } from "@/components/ChaseActions";
import { ClientClose } from "@/components/ClientClose";
import { MarkReadButton } from "@/components/MarkReadButton";
import { PatternSeen } from "@/components/PatternSeen";
import { ParkButton, UnparkButton } from "@/components/ParkButton";
import { FormNotNeeded } from "@/components/FormNotNeeded";
import { IconTile } from "@/components/ui";

const ICONS: Record<TodoIcon, typeof PawPrint> = {
  chat: MessagesSquare, vaccine: Syringe, form: ClipboardCheck, money: Banknote, alert: TriangleAlert, dog: PawPrint,
  message: MessageCircle, people: Users, pay: Wallet, deal: BriefcaseBusiness, camera: Camera
};
function ago(iso?: string) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}
const backIn = (iso: string) => {
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return m < 60 ? `Back in ${Math.max(1, m)} min` : m < 20 * 60 ? `Back in ${Math.round(m / 60)} h` : `Back ${new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", timeZone: "America/New_York" })} ET`;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const first = (n: string) => n.replace(/".*?"\s*/, "").split(" ")[0];

// What "I've done my bit" can mean, by kind of item
const TRAINER_KINDS = new Set(["trainer_silent", "form_chase", "client_waiting", "client_pileup", "followup_report", "intake_media_missing", "handover_photo_missing"]);
const MOVE_KINDS = new Set(["pickup_unconfirmed", "dropoff_unconfirmed"]);
const CLIENT_KINDS = new Set(["client_office", "client_urgent"]);
function parkOptions(i: TodoItem): string[] {
  if (i.decision) return ["Asked Sean", "Waiting on the client", "Other"];
  if (TRAINER_KINDS.has(i.kind || "")) return ["Called the trainer", "Messaged the trainer", "Trainer says it's handled outside the app", "Other"];
  if (MOVE_KINDS.has(i.kind || "")) return ["Called the trainer", "Changed it in HubSpot", "Other"];
  if (CLIENT_KINDS.has(i.kind || "") || i.pattern) return ["Replied to the client", "Called the client", "Asked the trainer", "Other"];
  return ["Changed it in HubSpot", "Messaged the client", "Asked Pedro", "Other"];
}

/** The admin To do list, in three shelves by whose move it is: Needs you (red), Waiting (amber: you've acted, it comes
 *  back by itself), and The app is on it (grey: not yours yet). Several items about one trainer fold into one card. */
export function TodoList({ items, late, beforeApp = [], canQuiet = false, pocs = [] }: { items: TodoItem[]; late: (Todo & { trainerName?: string; poc?: string })[]; beforeApp?: (Todo & { trainerName?: string; poc?: string })[]; canQuiet?: boolean; pocs?: string[] }) {
  const you = items.filter((i) => (i.shelf || "you") === "you" && i.group !== "later");
  const waiting = items.filter((i) => i.shelf === "waiting").sort((a, b) => a.park!.until.localeCompare(b.park!.until));
  const app = items.filter((i) => i.shelf === "app");
  const later = items.filter((i) => (i.shelf || "you") === "you" && i.group === "later");
  // Several items about the same trainer become one card (where the first of them stood)
  const perTrainer = new Map<string, TodoItem[]>();
  for (const i of you) if (i.trainer && !i.decision) perTrainer.set(i.trainer.id, [...(perTrainer.get(i.trainer.id) || []), i]);
  const seen = new Set<string>();
  const rows: ({ one: TodoItem } | { card: TodoItem[] })[] = [];
  for (const i of you) {
    const group = i.trainer && !i.decision ? perTrainer.get(i.trainer.id)! : null;
    if (group && group.length >= 2) { if (!seen.has(i.trainer!.id)) { seen.add(i.trainer!.id); rows.push({ card: group }); } }
    else rows.push({ one: i });
  }
  const old = you.filter((i) => i.since && Date.now() - new Date(i.since).getTime() >= 2 * 864e5);
  const byOwner = new Map<string, number>();
  for (const i of old) byOwner.set(i.poc || "no owner", (byOwner.get(i.poc || "no owner") || 0) + 1);
  const shelf = (href: string, n: number, label: string, cls: string) => <a href={href} className={`flex min-w-0 flex-1 items-center gap-2 rounded-2xl border px-3 py-2.5 ${cls}`}><span className="text-[22px] font-extrabold leading-none tabular-nums">{n}</span><span className="truncate text-small font-semibold">{label}</span></a>;
  return (
    <>
      <div id="todo-list">
      <div className="mt-4 flex gap-2">
        {shelf("#todo-now", you.length + (beforeApp.length ? 1 : 0), "Needs you", "border-heart/30 bg-heart-wash text-heart")}
        {shelf("#todo-waiting", waiting.length, "Waiting", "border-biscuit/50 bg-biscuit-wash text-warn")}
        {shelf("#todo-app", app.length + late.length, "The app is on it", "border-line bg-white text-ink-soft")}
      </div>
      {old.length > 0 && <p className="mt-3 rounded-xl bg-heart-wash px-3.5 py-2.5 text-body font-semibold text-heart">{old.length} open for 2 days or more: {[...byOwner.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(", ")}.</p>}
      <div className="mt-3"><TodoTypes pocs={pocs} /></div>

      <section id="todo-now" data-group="now" className="scroll-mt-20">
        <h2 className="group-title">Needs you<span className="count">{you.length + (beforeApp.length ? 1 : 0)}</span></h2>
        <p className="-mt-1.5 mb-2.5 px-1 text-small text-ink-faint">Your move. Do it, or park it once you&apos;ve done your bit and are waiting on someone.</p>
        {rows.length || beforeApp.length ? (
          <ul className="panel divide-y divide-line overflow-hidden">
            {rows.map((r) => "one" in r ? <Item key={r.one.key} i={r.one} canQuiet={canQuiet} /> : <TrainerCard key={`t-${r.card[0].trainer!.id}`} list={r.card} canQuiet={canQuiet} />)}
            {beforeApp.length > 0 && <FormGroup title={`${beforeApp.length} handover report${beforeApp.length > 1 ? "s" : ""} from before the app`} list={beforeApp}
              note={<>Needed for the client&apos;s certificate and report. If it already went out the old way, press &ldquo;Not needed&rdquo;.</>} />}
          </ul>
        ) : <p className="panel p-5 text-ink-soft">Nothing needs you right now.</p>}
      </section>

      {waiting.length > 0 && (
        <section id="todo-waiting" data-group="waiting" className="scroll-mt-20">
          <h2 className="group-title">Waiting<span className="count">{waiting.length}</span></h2>
          <p className="-mt-1.5 mb-2.5 px-1 text-small text-ink-faint">You&apos;ve acted. Each one comes back by itself, or disappears if it sorts itself first.</p>
          <ul className="panel divide-y divide-line overflow-hidden">
            {waiting.map((i) => (
              <li key={i.key} className="flex items-center gap-3 border-l-4 border-biscuit px-4 py-3" data-kind={i.icon || "alert"} data-poc={(i.poc || "").toLowerCase()}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{i.text}</p>
                  <p className="text-small text-ink-soft">{i.park!.by}: {i.park!.did.toLowerCase()}{(i.parks || 0) > 1 ? ` · park ${i.parks} of 3` : ""}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="rounded-full bg-biscuit-wash px-2.5 py-1 text-caption font-semibold text-warn">{backIn(i.park!.until)}</span>
                  <UnparkButton itemKey={i.key} />
                </div>
              </li>))}
          </ul>
        </section>
      )}

      {(app.length > 0 || late.length > 0) && (
        <section id="todo-app" data-group="app" className="scroll-mt-20">
          <details className="mt-6 rounded-[20px] border border-dashed border-line bg-white/60 px-4 py-3">
            <summary className="cursor-pointer text-body text-ink-soft"><b className="text-ink">The app is on it: {app.length + late.length}.</b> Not yours yet: it&apos;s reminding the trainer or the client. <span className="underline">Show</span></summary>
            {app.length > 0 && <ul className="mt-2 divide-y divide-line border-t border-line">{app.map((i) => (
              <li key={i.key} className="py-2.5" data-kind={i.icon || "alert"} data-poc={(i.poc || "").toLowerCase()}>
                <p className="font-semibold">{i.dogHref ? <Link prefetch={false} href={i.dogHref} className="hover:underline">{i.text}</Link> : i.text}</p>
                {i.detail && <p className="line-clamp-2 text-small text-ink-soft">{i.detail}</p>}
                <p className="text-caption text-ink-faint">Yours from {new Date(`${i.appUntil}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })} if it&apos;s still not done.</p>
              </li>))}</ul>}
            {late.length > 0 && <>
              <p className="mt-3 text-small font-semibold text-ink-soft">{late.length} late form{late.length > 1 ? "s" : ""}: the trainers are being reminded. Any still late after 2 reminders moves up to Needs you.</p>
              <ul className="mt-1 divide-y divide-line border-t border-line">{late.map((t) => <TodoRow key={`${t.booking.id}-${t.window.kind}-${t.window.week}`} t={t} mode="admin" poc={t.poc || ""} />)}</ul>
            </>}
          </details>
        </section>
      )}

      {later.length > 0 && (
        <section id="todo-later" data-group="later" className="scroll-mt-20">
          <h2 className="group-title">When you have a minute<span className="count">{later.length}</span></h2>
          <ul className="panel divide-y divide-line overflow-hidden">{later.map((i) => <Item key={i.key} i={i} canQuiet={canQuiet} />)}</ul>
        </section>
      )}
      <p className="mt-5 px-1 text-small text-ink-soft">Nothing is lost: everything that was closed or parked is in the <Link prefetch={false} href="/a/log" className="font-semibold underline">activity log</Link>.</p>
      </div>
    </>
  );
}

/** Several things about one trainer, behind one card: closed, it's the trainer, how many things and who owns them; tap it
 *  and it drops down to every item, each with its own buttons (its own Park too), and the trainer's contact card. */
function TrainerCard({ list, canQuiet }: { list: TodoItem[]; canQuiet: boolean }) {
  const t = list[0].trainer!, chase = list.find((i) => i.chase)?.chase, name = first(t.name);
  const owners = [...new Set(list.map((i) => i.poc).filter(Boolean))] as string[];
  const oldest = Math.floor(Math.max(0, ...list.map((i) => (i.since ? (Date.now() - new Date(i.since).getTime()) / 864e5 : 0))));
  const short = (i: TodoItem) => (i.text.startsWith(t.name) ? i.text.slice(t.name.length).trim() : i.text);
  const initials = t.name.replace(/".*?"/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <li data-card className="border-l-4 border-heart">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <IconTile tone="heart"><Users size={19} /></IconTile>
          <span className="min-w-0 flex-1">
            <span className="block font-bold leading-snug">{t.name}: {list.length} things</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-caption">
              {oldest >= 2 && <span className="rounded-full bg-heart px-2 py-0.5 font-semibold text-white">Oldest open {oldest} days</span>}
              <span className={`rounded-full px-2 py-0.5 font-semibold ${owners.length ? "bg-mint-wash text-fern" : "bg-biscuit-wash text-warn"}`}>{owners.length ? `Owner${owners.length > 1 ? "s" : ""}: ${owners.join(", ")}` : "No owner"}</span>
            </span>
            <span className="mt-1.5 block text-body leading-snug text-ink-soft group-open:hidden">{list.slice(0, 3).map(short).join(" · ")}{list.length > 3 ? ` · and ${list.length - 3} more` : ""}</span>
          </span>
          <ChevronDown size={20} className="mt-1 shrink-0 text-ink-soft transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-3 px-4 pb-4">
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
            {list.map((i) => <Item key={i.key} i={i} canQuiet={canQuiet} nested strip={t.name} />)}
          </ul>
          <div className="rounded-2xl border border-line bg-mint-wash/60 p-3.5">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-small font-extrabold text-fern" aria-hidden>{initials}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold leading-tight">Contact {name}</p>
                <p className="text-small text-ink-soft">One call can cover all {list.length}. Then park each one you&apos;ve dealt with.</p>
              </div>
            </div>
            <div className="mt-3">
              {chase ? <ChaseActions c={chase} extra={<Link prefetch={false} href={`/a/trainers/${t.id}`} className="btn-ghost h-10 min-h-0 px-3.5 text-small">Trainer page</Link>} />
                : <div className="flex flex-wrap gap-2"><Link prefetch={false} href={`/a/messages/${t.id}`} className="btn-ghost h-10 min-h-0 px-3.5 text-small"><MessageCircle size={15} />Message {name}</Link><Link prefetch={false} href={`/a/trainers/${t.id}`} className="btn-ghost h-10 min-h-0 px-3.5 text-small">Trainer page</Link></div>}
            </div>
          </div>
        </div>
      </details>
    </li>
  );
}

/** A list of forms folded into one To do row. */
function FormGroup({ title, list, note }: { title: string; list: (Todo & { trainerName?: string; poc?: string })[]; note: React.ReactNode }) {
  return (
    <li data-kind="form">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <IconTile tone="biscuit"><ClipboardCheck size={19} /></IconTile>
          <span className="min-w-0 flex-1 font-bold">{title}</span>
          <span className="btn-ghost h-9 min-h-0 px-3 text-small group-open:hidden">Show</span>
          <span className="btn-ghost hidden h-9 min-h-0 px-3 text-small group-open:inline-flex">Hide</span>
        </summary>
        <ul className="divide-y divide-line border-t border-line bg-canvas/60">{list.map((t) => <TodoRow key={`${t.booking.id}-${t.window.kind}-${t.window.week}`} t={t} mode="admin" poc={t.poc || ""} />)}</ul>
        <p className="border-t border-line px-4 py-2.5 text-caption text-ink-faint">{note}</p>
      </details>
    </li>
  );
}

// A row is always the same five lines at most: what, a line of detail, its pills, ONE row of buttons, and one quiet line
// of links. "Open dog" and "Open chat" are links, not the main button; everything a row can do sits on the one button row.
const LINKISH = /^(dog|open dog|open chat)$/i;
function Item({ i, canQuiet = false, nested = false, strip = "" }: { i: TodoItem; canQuiet?: boolean; nested?: boolean; strip?: string }) {
  const I = ICONS[i.icon || "alert"];
  const tone = i.tone === "heart" ? "heart" : i.tone === "biscuit" ? "biscuit" : "paper";
  const d = i.since ? (Date.now() - new Date(i.since).getTime()) / 864e5 : 0;
  const bar = nested ? "" : `border-l-4 ${i.back ? "border-biscuit" : i.tone === "heart" ? "border-heart" : "border-transparent"}`;
  const text = strip && i.text.startsWith(strip) ? i.text.slice(strip.length).trim().replace(/^./, (c) => c.toUpperCase()) : i.text;
  const primary = i.primary && !LINKISH.test(i.primary.label) ? i.primary : null, link = i.primary && !primary ? i.primary : null;
  const park = i.parkable || ((i.parks || 0) >= 3 && !i.passed)
    ? <ParkButton keys={[i.key]} parks={i.parks || 0} options={parkOptions(i)} trainerId={i.trainer?.id} what={i.text} /> : null;
  const done = i.form ? <FormNotNeeded bookingId={i.form.bookingId} kind={i.form.kind} week={i.form.week} />
    : i.incidentId && !i.deal && !i.ask && !i.chase && !i.clear ? <TodoDone id={i.incidentId} label={i.doneLabel} /> : null;
  const own = <>
    {i.incidentId && i.clear && <ClientClose id={i.incidentId} mode={i.clear} quick={i.repliedInChat ? "Handled in the chat" : undefined} />}
    {i.readTrainer && <MarkReadButton trainerId={i.readTrainer} />}
    {i.pattern && <PatternSeen chatId={i.pattern} />}
    {i.ask && <AskDecision id={i.ask.id} kind={i.ask.kind} expired={i.ask.expired} trainer={i.ask.trainer} dealId={i.ask.dealId} />}
    {i.deal && <DealDecision dealId={i.deal} bookHref={`/a/bookings/new?deal=${i.deal}`} />}
    {i.booking && <BookingDecision bookingId={i.booking.id} move={i.booking.move} dog={i.booking.dog} trainer={i.booking.trainer} hasDeal={i.booking.hasDeal} />}
    {park}
    {done}
  </>;
  const main = primary ? (primary.external
    ? <a href={primary.href} target="_blank" rel="noopener" className="btn-ink h-10 min-h-0 px-4 text-small">{primary.label}<ExternalLink size={13} /></a>
    : <Link prefetch={false} href={primary.href} className="btn-ink h-10 min-h-0 px-4 text-small">{primary.label}</Link>) : null;
  return (
    <li className={`flex gap-3 ${nested ? "px-3.5 py-3.5" : "p-4"} ${bar}`} data-kind={i.icon || "alert"} data-poc={(i.poc || "").toLowerCase()}>
      <IconTile tone={tone}><I size={19} /></IconTile>
      <div className="min-w-0 flex-1">
        <p className="font-bold leading-snug">{text}</p>
        {i.detail && <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-body leading-snug text-ink-soft">{i.detail}</p>}
        {i.back && <p className="mt-1.5 rounded-lg bg-biscuit-wash px-2.5 py-1.5 text-small font-semibold text-warn">Back: {i.back.by} {i.back.did.charAt(0).toLowerCase() + i.back.did.slice(1)} on {when(i.back.at)}. It&apos;s still open.</p>}
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption">
          {i.since && <span className={`rounded-full px-2 py-0.5 font-semibold ${d >= 2 ? "bg-heart text-white" : "bg-paper text-ink-soft"}`}>{d >= 2 ? `Open ${Math.floor(d)} days` : ago(i.since)}</span>}
          {i.since && !nested && <span className={`rounded-full px-2 py-0.5 font-semibold ${i.poc ? "bg-mint-wash text-fern" : "bg-biscuit-wash text-warn"}`}>{i.poc ? `Owner: ${i.poc}` : "No owner"}</span>}
          {(i.parks || 0) > 0 && !i.passed && <span className="rounded-full bg-biscuit-wash px-2 py-0.5 font-semibold text-warn">Parked {i.parks === 1 ? "once" : i.parks === 2 ? "twice" : "3 times: no more"}</span>}
          {i.passed && <span className="rounded-full bg-heart px-2 py-0.5 font-semibold text-white">Passed to Pedro by {i.passed.by}</span>}
        </p>
        <div className="mt-2.5 flex flex-wrap items-start gap-2">
          {/* On its own, a trainer item has Call and Message on the same row; inside a trainer's card those are on the contact card */}
          {i.chase && !nested ? <ChaseActions c={i.chase} lead={main} extra={own} /> : <>{main}{own}</>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-faint">
          {i.chase && <span>Clears itself when {first(i.chase.trainerName)} {i.chase.kind === "form_late" ? "sends the form" : i.chase.kind === "client_waiting" ? "or the office replies" : "posts"}.</span>}
          {link && <Link prefetch={false} href={link.href} className="font-semibold text-ink-soft underline">{/chat/i.test(link.label) ? "Open chat" : "Open dog"}</Link>}
          {i.dogHref && i.primary?.href !== i.dogHref && <Link prefetch={false} href={i.dogHref} className="font-semibold text-ink-soft underline">Open dog</Link>}
          {i.hubspot && !primary?.external && <a href={i.hubspot} target="_blank" rel="noopener" className="font-semibold text-ink-soft underline">HubSpot</a>}
          {canQuiet && i.quietChatId && <QuietChatButton chatId={i.quietChatId} quiet={false} small />}
          {!!i.chase?.history.length && (
            <details className="w-full">
              <summary className="inline cursor-pointer font-semibold text-ink-soft underline">What the app already did ({i.chase.history.length})</summary>
              <ul className="mt-1 space-y-0.5 border-l-2 border-line pl-2.5 text-ink-soft">{i.chase.history.map((h, k) => <li key={k}>{h}</li>)}</ul>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}
