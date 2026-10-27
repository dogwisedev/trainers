import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { requireRole } from "@/lib/data";
import { serviceClient, isDemo } from "@/lib/supabase";
import { dealKey } from "@/lib/chatTypes";
import type { ChatRow } from "@/lib/chatTypes";
import type { Booking } from "@/lib/types";
import { etParts, INCIDENT_LABEL, IncidentKind } from "@/lib/chatRules";
import { daysBetween, short } from "@/lib/dates";
import { expectedReports, kindName, Kind, Status } from "@/lib/reports";
import { datesFromHubspot } from "@/lib/hubspot";
import { loadProfile, readinessFor } from "@/lib/pretraining";
import { dogPage, hubspotDeal } from "@/lib/todo";
import { TRIP_LABEL } from "@/lib/payroll";
import { remainingOf } from "@/lib/money";
import { FollowupDates } from "@/components/FollowupDates";
import { LinkDeal } from "@/components/LinkDeal";
import { ChangeTrainer } from "@/components/ChangeTrainer";
import { emailTrainerAboutBooking, setBookingStatus } from "@/app/actions";
import { ActionButton, ExtraDays } from "@/components/forms";
import { ReportsToggle } from "@/components/ReportsToggle";
import { StartChat } from "@/components/StartChat";
import { CloseChat } from "@/components/ChatActions";
import { trainingOver } from "@/lib/chatOps";
import { AdminChatPanel } from "@/components/AdminChatPanel";
import { DogProfile } from "@/components/DogProfile";
import { TodoDone } from "@/components/TodoDone";
import { WaiveButton } from "@/components/WaiveButton";
import { Avatar, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the Before training tab reads HubSpot; closing a chat saves to Drive

type Tab = "overview" | "before" | "chat" | "forms";
const TABS: { key: Tab; label: string }[] = [{ key: "overview", label: "Overview" }, { key: "before", label: "Before training" }, { key: "chat", label: "Chat" }, { key: "forms", label: "Forms" }];
const long = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// One page per dog (a booking): everything about it in one place, with the HubSpot deal one click away.
export default async function DogPageView({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  const v = await requireRole("admin");
  if (isDemo()) return <p className="panel p-6 text-ink-soft">Dog pages need the database: not available in demo mode.</p>;
  const tab = (TABS.some((t) => t.key === searchParams.tab) ? searchParams.tab : "overview") as Tab;
  const sb = serviceClient();
  const { data } = await sb.from("bookings").select("*, trainers(id, name)").eq("id", params.id).maybeSingle();
  if (!data) notFound();
  const b = data as Booking & { trainers: { id: string; name: string } | null; created_at?: string; source?: string | null };
  const key = dealKey(b), deal = hubspotDeal(b.hubspot_deal_id), today = etParts(new Date()).date;
  const { data: chatRows } = await sb.from("chats").select("*").eq("deal_key", key).order("created_at", { ascending: false });
  const chat = (((chatRows || []) as ChatRow[]).find((c) => c.status === "open") || (chatRows || [])[0] || null) as ChatRow | null;
  const over = chat ? await trainingOver(chat.id) : null;
  const closeAfter = over && !over.over ? (over.lastDropOff ? short(over.lastDropOff) : "the last drop-off") : null;
  const { data: activeTrainers } = await sb.from("trainers").select("id, name").eq("active", true).order("name");
  const [{ data: siblings }, { data: reps }, { data: incs }, ready, { data: ireports }, { data: trips }, { data: money }, { data: rate }] = await Promise.all([
    b.hubspot_deal_id ? sb.from("bookings").select("id, dog_name, status").eq("hubspot_deal_id", b.hubspot_deal_id).neq("id", b.id) : Promise.resolve({ data: [] }),
    sb.from("reports").select("id, kind, week_number, status").eq("booking_id", b.id),
    sb.from("chat_incidents").select("id, kind, detail, opened_at").neq("status", "resolved").or(`booking_id.eq.${b.id}${chat ? `,chat_id.eq.${chat.id}` : ""}`).order("opened_at"),
    readinessFor([b.id]),
    sb.from("incident_reports").select("*").eq("booking_id", b.id).order("occurred_at", { ascending: false }),
    sb.from("trips").select("id, kind, trip_date, miles, notes, created_by").eq("booking_id", b.id).order("trip_date"),
    b.hubspot_deal_id ? sb.from("deal_money").select("*").eq("deal_id", b.hubspot_deal_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("trainer_rates").select("followup_rate").eq("trainer_id", b.trainer_id).maybeSingle()
  ]);
  const m = money as { amount: number | null; amount_paid: number | null; payment_status: string | null; remaining_balance_link: string | null; link_by_app: boolean; followups: string[]; closed_on: string | null; synced_at: string | null } | null;
  const r = ready.get(b.id);
  const missing = r?.ready.missing.length ?? null;
  const toReview = ((reps || []) as { status: Status }[]).filter((x) => x.status === "submitted").length;
  const status = b.status === "cancelled" ? { label: "Cancelled", tone: "heart" as const } : b.end_date < today ? { label: "Finished", tone: "line" as const }
    : b.start_date <= today ? { label: "In care", tone: "biscuit" as const } : { label: `Starts in ${daysBetween(today, b.start_date)} day${daysBetween(today, b.start_date) === 1 ? "" : "s"}`, tone: "mint" as const };
  const badge = (t: Tab) => t === "before" && missing ? missing : t === "forms" && toReview ? toReview : 0;

  return (
    <>
      <Link prefetch={false} href="/a/dogs" className="mb-2 inline-flex items-center gap-1 text-body font-semibold text-ink-soft hover:text-ink"><ChevronLeft size={17} />Dogs</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={b.dog_name || "Dog"} size={52} />
          <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-h1 font-extrabold leading-tight">{b.dog_name || "Dog"} <Pill tone={status.tone}>{status.label}</Pill>
            {b.status !== "cancelled" && b.end_date >= today && missing !== null && <Link prefetch={false} href={dogPage(b.id, "before")}><Pill tone={missing ? "heart" : "mint"}>{missing ? `${missing} missing before training` : r?.dog.cleared ? "OK to start" : "Ready"}</Pill></Link>}
          </h1>
          <p className="mt-1 text-body text-ink-soft">{b.client_name}, with {b.trainers ? <Link prefetch={false} href={`/a/trainers/${b.trainers.id}`} className="underline">{b.trainers.name}</Link> : "no trainer"}<span className="block text-body">{short(b.start_date)} to {short(b.end_date)}</span></p>
          </div>
        </div>
        {deal ? <a href={deal} target="_blank" rel="noopener" className="btn-ink h-10 min-h-0 px-4">HubSpot deal<ExternalLink size={15} /></a>
          : <span className="text-small text-ink-faint">No HubSpot deal linked</span>}
      </div>

      <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Dog page">
        {TABS.map((t) => (
          <Link key={t.key} prefetch={false} href={dogPage(b.id, t.key === "overview" ? undefined : t.key)} aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-body font-semibold ${tab === t.key ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>
            {t.label}{badge(t.key) ? <span className="ml-1.5 rounded-full bg-heart px-1.5 text-micro text-white">{badge(t.key)}</span> : null}
          </Link>
        ))}
      </nav>

      <div className="mt-5">
        {tab === "overview" && (
          <div className="space-y-5">
            {((incs || []) as { id: string; kind: IncidentKind; detail: string | null }[]).length > 0 && (
              <section>
                <h2 className="group-title">To do for {b.dog_name || "this dog"}</h2>
                <ul className="panel divide-y divide-line">
                  {((incs || []) as { id: string; kind: IncidentKind; detail: string | null }[]).map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 p-3.5">
                      <div className="min-w-0 flex-1"><p className="font-semibold">{INCIDENT_LABEL[i.kind] || i.kind}</p>{i.detail && <p className="text-small text-ink-soft">{i.detail}</p>}</div>
                      <TodoDone id={i.id} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="panel p-4">
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Fact k="Pickup" v={long(b.start_date)} />
                <Fact k="Drop-off" v={long(b.end_date)} />
                <Fact k="Program" v={`${b.program || `${b.weeks}-week`}${b.extra_days ? ` + ${b.extra_days} day${b.extra_days > 1 ? "s" : ""}` : ""}${b.rehab ? " (rehab)" : ""}`} />
                <Fact k="Trainer" v={b.trainers?.name || "None"} />
                <Fact k="Client" v={b.client_name} />
                <Fact k="Client email" v={b.client_email || "Not given"} />
                {b.notes && <div className="sm:col-span-2"><Fact k="Notes" v={b.notes} /></div>}
                <Fact k="HubSpot deal" v={b.hubspot_deal_id || "None"} />
                <Fact k="Dates" v={b.hubspot_deal_id && datesFromHubspot() ? "From HubSpot (change them on the deal)" : "Set in the app"} />
              </dl>
            </section>
            {!b.hubspot_deal_id && <LinkDeal bookingId={b.id} hasDeal={false} />}
            {b.hubspot_deal_id && (
              <section className="panel p-4">
                <h2 className="mb-3 text-lead font-extrabold">Payment</h2>
                {m ? (
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                    <Fact k="Program price" v={usd(m.amount)} />
                    <Fact k="Paid" v={usd(m.amount_paid)} />
                    <Fact k="Remaining" v={usd(remainingOf({ amount: Number(m.amount), amount_paid: Number(m.amount_paid), payment_status: m.payment_status }))} />
                    <Fact k="Status" v={m.payment_status || "Not set"} />
                    {m.remaining_balance_link && <div className="col-span-2 sm:col-span-4"><dt className="text-small text-ink-soft">Balance link{m.link_by_app ? " (made by the app in Stripe)" : ""}</dt><dd><a href={m.remaining_balance_link} target="_blank" rel="noopener" className="break-all text-body font-semibold underline">{m.remaining_balance_link}</a></dd></div>}
                  </dl>
                ) : <p className="text-body text-ink-soft">Not read from HubSpot yet: it updates every 30 minutes.</p>}
              </section>
            )}
            {b.hubspot_deal_id && b.status !== "cancelled" && (
              <section className="panel p-4">
                <h2 className="mb-3 text-lead font-extrabold">Follow-up sessions</h2>
                <FollowupDates bookingId={b.id} dates={m?.followups || []} rate={Number((rate as { followup_rate?: number } | null)?.followup_rate ?? 60)} />
              </section>
            )}
            <section className="panel space-y-3 p-4">
              <h2 className="text-lead font-extrabold">Actions</h2>
              {b.hubspot_deal_id && <LinkDeal bookingId={b.id} hasDeal />}
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton className="btn-ghost" action={emailTrainerAboutBooking.bind(null, b.id)}>{b.notified_at ? "Email the trainer again" : "Email the trainer"}</ActionButton>
                {!chat && <StartChat bookingId={b.id} />}
                {b.status !== "cancelled" && b.end_date > today && <ChangeTrainer bookingId={b.id} dog={b.dog_name || "the dog"} current={b.trainers?.name || "the trainer"} start={b.start_date} end={b.end_date} today={today} trainers={((activeTrainers || []) as { id: string; name: string }[]).filter((t) => t.id !== b.trainer_id)} />}
                {b.status !== "cancelled" && <ActionButton className="btn-danger" confirm={`Cancel ${b.dog_name || "this booking"}? The kennel frees up straight away, and the office is asked about a refund or partial pay.`} action={setBookingStatus.bind(null, b.id, "cancelled")}>Cancel training</ActionButton>}
              </div>
              <p className="text-small text-ink-soft">{b.notified_at ? `Trainer emailed ${new Date(b.notified_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : "The trainer hasn't been emailed about this booking yet."}</p>
              <div className="flex flex-wrap items-center gap-4 border-t border-line pt-3 text-body">
                <span className="flex items-center gap-2">Forms <ReportsToggle id={b.id} on={!!b.reports_enabled} /></span>
                {!(b.hubspot_deal_id && datesFromHubspot()) && b.status !== "cancelled" && <span className="flex items-center gap-2">Extra days <ExtraDays id={b.id} current={b.extra_days || 0} /></span>}
              </div>
            </section>
            {((ireports || []) as IReport[]).length > 0 && (
              <section id="incident-reports" className="scroll-mt-20">
                <h2 className="group-title">Incident reports</h2>
                <ul className="space-y-3">
                  {((ireports || []) as IReport[]).map((x) => (
                    <li key={x.id} className="panel border-heart p-4">
                      <p className="font-bold">{x.kind} <span className="font-normal text-ink-soft">{new Date(x.occurred_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}, reported by {x.reported_by}</span></p>
                      <dl className="mt-2 space-y-2 text-body">
                        <Fact k="What happened" v={x.what} />
                        {x.action && <Fact k="What they did" v={x.action} />}
                        <Fact k="Vet" v={x.vet ? `Yes: ${x.vet_details || ""}` : "No"} />
                        <Fact k="Client told" v={x.client_told ? "Yes" : "No"} />
                      </dl>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {((trips || []) as Trip[]).length > 0 && (
              <section className="panel p-4">
                <h2 className="mb-2 text-body font-bold">Trips (mileage)</h2>
                <ul className="divide-y divide-line text-body">
                  {((trips || []) as Trip[]).map((t) => (
                    <li key={t.id} className="py-2"><span className="font-semibold">{short(t.trip_date)}</span> {TRIP_LABEL[t.kind]}, {Number(t.miles)} mi{t.notes ? <span className="block text-small text-ink-soft">{t.notes}</span> : null}</li>
                  ))}
                </ul>
              </section>
            )}
            {((siblings || []) as { id: string; dog_name: string | null; status: string }[]).length > 0 && (
              <section className="panel p-4">
                <h2 className="mb-2 text-body font-bold">Other dogs on this deal</h2>
                <div className="flex flex-wrap gap-2">{((siblings || []) as { id: string; dog_name: string | null; status: string }[]).map((s) => <Link key={s.id} prefetch={false} href={dogPage(s.id)} className="btn-ghost h-9 min-h-0 px-3 text-small">{s.dog_name || "Dog"}{s.status === "cancelled" ? " (cancelled)" : ""}</Link>)}</div>
              </section>
            )}
          </div>
        )}

        {tab === "before" && <BeforeTab b={b} chat={chat} />}

        {tab === "chat" && (chat ? (
          <>
            {chat.status === "open" && <div className="mb-3 flex justify-end"><CloseChat chatId={chat.id} title={chat.title || "this dog"} after={closeAfter} /></div>}
            <AdminChatPanel chat={chat} me={{ userId: v.userId, name: v.name }} />
          </>
        ) : <div className="panel p-5"><p className="mb-3 text-ink-soft">No chat for this dog yet.</p><StartChat bookingId={b.id} /></div>)}

        {tab === "forms" && <FormsTab b={b} reps={(reps || []) as { id: string; kind: Kind; week_number: number; status: Status }[]} today={today} />}
      </div>
    </>
  );
}

type IReport = { id: string; kind: string; occurred_at: string; reported_by: string; what: string; action: string | null; vet: boolean; vet_details: string | null; client_told: boolean };
type Trip = { id: string; kind: "pickup" | "dropoff" | "followup"; trip_date: string; miles: number; notes: string | null };

const usd = (n: number | null | undefined) => (n == null ? "-" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" }));

function Fact({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-small text-ink-soft">{k}</dt><dd className="whitespace-pre-wrap text-body">{v}</dd></div>;
}

async function BeforeTab({ b, chat }: { b: Booking; chat: ChatRow | null }) {
  if (!b.hubspot_deal_id) return <p className="panel p-5 text-ink-soft">This booking has no HubSpot deal, so there are no client forms to show.</p>;
  if (!chat) return <div className="panel p-5"><p className="mb-3 text-ink-soft">Start the dog&apos;s chat first: the client fills in what&apos;s missing from there.</p><StartChat bookingId={b.id} /></div>;
  const profile = await loadProfile(b.hubspot_deal_id);
  if (!profile) return <p className="panel p-5 text-ink-soft">Couldn&apos;t load this dog&apos;s details from HubSpot. Try again in a minute.</p>;
  return <DogProfile chatId={chat.id} role="admin" edit open={chat.status === "open"} profile={profile} dogId={b.id} base={`/a/dogs/${b.id}`} dogLink="/a/dogs/{id}?tab=before" />;
}

function FormsTab({ b, reps, today }: { b: Booking; reps: { id: string; kind: Kind; week_number: number; status: Status }[]; today: string }) {
  const windows = expectedReports({ ...b, weeks: b.weeks });
  return (
    <div className="space-y-3">
      {!b.reports_enabled && <p className="rounded-xl bg-biscuit-wash p-3 text-body font-semibold text-warn">Forms are off for this dog. Turn them on in Overview.</p>}
      <ul className="panel divide-y divide-line">
        {windows.map((w) => {
          const r = reps.find((x) => x.kind === w.kind && x.week_number === w.week);
          const name = `${kindName(w.kind)}${w.kind === "weekly" ? ` (week ${w.week})` : ""}`;
          const late = today > w.deadline ? daysBetween(w.deadline, today) : 0;
          const st = r?.status === "approved" ? { t: "Done", tone: "mint" as const } : r?.status === "submitted" ? { t: "To review", tone: "biscuit" as const }
            : r?.status === "changes_requested" ? { t: "Sent back", tone: "biscuit" as const } : r?.status === "waived" ? { t: "Not needed", tone: "line" as const }
            : today < w.opens ? { t: `Opens ${short(w.opens)}`, tone: "line" as const } : late ? { t: `${late} day${late > 1 ? "s" : ""} late`, tone: "heart" as const } : { t: `Due ${short(w.deadline)}`, tone: "mint" as const };
          const href = r ? `/a/reports/${r.id}` : `/a/reports/new?booking=${b.id}&kind=${w.kind}&week=${w.week}`;
          const verb = r?.status === "submitted" ? "Review" : r ? "Open" : "Fill in";
          return (
            <li key={`${w.kind}-${w.week}`} className="flex flex-wrap items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1"><p className="font-semibold">{name}</p><p className="text-small text-ink-soft">{short(w.opens)} to {short(w.deadline)}</p></div>
              <Pill tone={st.tone}>{st.t}</Pill>
              {(!r || r.status === "draft" || r.status === "changes_requested") && today >= w.opens && <WaiveButton bookingId={b.id} kind={w.kind} week={w.week} reportId={r?.id} />}
              {(r || today >= w.opens) && <Link prefetch={false} href={href} className={`${r?.status === "submitted" ? "btn-ink" : "btn-ghost"} h-9 min-h-0 px-3 text-small`}>{verb}</Link>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
