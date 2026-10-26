import "server-only";
import { serviceClient, isDemo } from "./supabase";
import { addDays, short } from "./dates";
import { etParts, INCIDENT_LABEL, IncidentKind } from "./chatRules";
import { BookingForReports, Kind, RowLike, Todo, kindName, todos } from "./reports";
import { trainerSignins } from "./trainerSignin";
import { dealKey } from "./chatTypes";
import { cronProblems } from "./cronHealth";

// The admin "To do" list: everything that needs a person, in one place, most urgent first.
// Sources: open incidents (chats, forms, bookings, HubSpot, before training), forms sent in for review,
// unread trainer messages, trainer profile flags, trainers who haven't signed in, and late forms (grouped).
// Callers must have checked the viewer is an admin: this reads with the service key (the daily email has no session).

export type TodoGroup = "now" | "week" | "later";
export type TodoIcon = "chat" | "vaccine" | "form" | "money" | "alert" | "dog" | "message" | "people" | "pay" | "deal" | "camera";
export type TodoItem = {
  key: string; group: TodoGroup; tone: "heart" | "biscuit" | "line"; icon?: TodoIcon; text: string; detail?: string; since?: string;
  primary?: { label: string; href: string; external?: boolean };
  dogHref?: string; hubspot?: string; incidentId?: string; doneLabel?: string;
};
export type TodoData = { items: TodoItem[]; late: (Todo & { trainerName: string })[] };

export const hubspotDeal = (id: string | null | undefined) => (id && /^\d+$/.test(id) ? `https://app.hubspot.com/contacts/21869370/record/0-3/${id}` : undefined);
export const dogPage = (bookingId: string, tab?: string, hash?: string) => `/a/dogs/${bookingId}${tab ? `?tab=${tab}` : ""}${hash ? `#${hash}` : ""}`;

type Inc = {
  id: string; kind: IncidentKind; status: string; detail: string | null; opened_at: string; chat_id: string | null; booking_id: string | null; report_id: string | null; ref: string | null;
  chat: { id: string; title: string | null; client_name: string | null; trainer_name: string | null; deal_key: string } | null;
  booking: { id: string; dog_name: string | null; client_name: string; start_date: string; hubspot_deal_id: string | null; trainer_id: string; trainers: { name: string } | null } | null;
};
type B = BookingForReports & { hubspot_deal_id: string | null; reports_enabled?: boolean | null };

const NOW_KINDS: IncidentKind[] = ["trainer_report", "client_waiting", "client_pileup", "trainer_silent", "check_vaccines", "booking_cancelled", "length_changed", "overbooked"];

export async function buildTodo(): Promise<TodoData> {
  if (isDemo()) return { items: [], late: [] };
  const sb = serviceClient(), today = etParts(new Date()).date;
  const [{ data: incs }, { data: reps }, { data: msgs }, { data: trainers }, signins, { data: bks }] = await Promise.all([
    sb.from("chat_incidents").select("id, kind, status, detail, opened_at, chat_id, booking_id, report_id, ref, chat:chats(id, title, client_name, trainer_name, deal_key), booking:bookings!booking_id(id, dog_name, client_name, start_date, hubspot_deal_id, trainer_id, trainers(name))").neq("status", "resolved").order("opened_at"),
    sb.from("reports").select("id, kind, week_number, booking_id, submitted_at, trainers(name), booking:bookings!booking_id(dog_name, client_name, hubspot_deal_id)").eq("status", "submitted").order("submitted_at"),
    sb.from("messages").select("trainer_id, created_at, body").eq("sender_role", "trainer").is("read_at", null).order("created_at"),
    sb.from("trainers").select("id, name, data_flags, active, probation"),
    trainerSignins().catch(() => []),
    sb.from("bookings").select("id, trainer_id, client_name, dog_name, start_date, end_date, weeks, status, reports_enabled, hubspot_deal_id").neq("status", "cancelled").gte("end_date", addDays(today, -75))
  ]);
  const bookings = (bks || []) as B[];
  const tName = new Map(((trainers || []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const bookingOfKey = (key: string) => bookings.find((b) => dealKey(b) === key);
  const items: TodoItem[] = [];

  // ── Incidents ──
  for (const i of (incs || []) as unknown as Inc[]) {
    const bk = i.booking || (i.chat ? bookingOfKey(i.chat.deal_key) : undefined);
    const bookingId = i.booking?.id || bk?.id;
    const dog = i.booking?.dog_name || i.chat?.title || bk?.dog_name || "the dog";
    const client = i.chat?.client_name || i.booking?.client_name || bk?.client_name || "The client";
    const trainer = i.chat?.trainer_name || i.booking?.trainers?.name || (bk ? tName.get(bk.trainer_id) : "") || "The trainer";
    const deal = hubspotDeal(i.booking?.hubspot_deal_id || bk?.hubspot_deal_id || (i.chat && /^\d+$/.test(i.chat.deal_key) ? i.chat.deal_key : null));
    const chat = i.chat_id ? { label: "Open chat", href: `/a/chats/${i.chat_id}` } : undefined;
    const dogHref = bookingId ? dogPage(bookingId) : undefined;
    const startsSoon = !!i.booking && i.booking.start_date <= addDays(today, 2);
    const base = { key: `inc:${i.id}`, since: i.opened_at, incidentId: i.id, dogHref, hubspot: deal, detail: i.detail || undefined };
    const ICON: Partial<Record<IncidentKind, TodoIcon>> = { client_waiting: "chat", client_pileup: "chat", trainer_silent: "chat", reopened: "chat", ready_to_close: "chat",
      intake_media_missing: "camera", handover_photo_missing: "camera", overbooked: "dog", length_changed: "money", booking_cancelled: "money", hubspot_problem: "deal",
      not_ready: "dog", check_vaccines: "vaccine", trainer_report: "alert" };
    const add = (o: Omit<TodoItem, "key" | "since" | "incidentId" | "dogHref" | "hubspot"> & Partial<TodoItem>) => items.push({ ...base, icon: ICON[i.kind] || "alert", ...o });
    switch (i.kind) {
      case "client_waiting": add({ group: "now", tone: "heart", text: `${client} is waiting for a reply about ${dog}`, primary: chat ? { ...chat, label: "Reply" } : undefined }); break;
      case "client_pileup": add({ group: "now", tone: "heart", text: `${client} has sent several messages about ${dog}`, primary: chat ? { ...chat, label: "Reply" } : undefined }); break;
      case "trainer_silent": add({ group: "now", tone: "heart", text: `${trainer} hasn't posted about ${dog} today`, primary: chat }); break;
      case "reopened": add({ group: "week", tone: "biscuit", text: `${client} started a new chat about ${dog}`, primary: chat }); break;
      case "ready_to_close": add({ group: "week", tone: "line", text: `${dog}'s chat can be closed`, primary: chat ? { ...chat, label: "Open chat to close" } : undefined }); break;
      case "intake_media_missing": add({ group: "week", tone: "biscuit", text: `${dog}'s intake form came in without pickup photos or video`, primary: chat }); break;
      case "handover_photo_missing": add({ group: "week", tone: "biscuit", text: `${dog}'s handover has no photo with the trainer`, primary: i.report_id ? { label: "Open form", href: `/a/reports/${i.report_id}` } : chat }); break;
      case "overbooked": add({ group: "now", tone: "heart", text: `${trainer} has more dogs than kennels`, primary: i.booking ? { label: "Open trainer", href: `/a/trainers/${i.booking.trainer_id}` } : undefined }); break;
      case "length_changed": add({ group: "now", tone: "heart", text: `${dog}'s program length changed: check pay and refund`, primary: deal ? { label: "HubSpot deal", href: deal, external: true } : undefined }); break;
      case "booking_cancelled": add({ group: "now", tone: "heart", text: `${dog}'s training was cancelled: refund or partial pay?`, primary: deal ? { label: "HubSpot deal", href: deal, external: true } : undefined }); break;
      case "hubspot_problem": add({ group: "week", tone: "biscuit", text: `Check ${dog}'s HubSpot deal`, primary: deal ? { label: "HubSpot deal", href: deal, external: true } : dogHref ? { label: "Open dog", href: dogHref } : undefined }); break;
      case "not_ready": add({ group: startsSoon ? "now" : "week", tone: "heart", detail: (i.detail || "").replace(/^.*?isn't ready:\s*/, "Missing: ").replace(/\.$/, "") || undefined, text: `${dog} starts ${i.booking ? short(i.booking.start_date) : "soon"} and isn't ready`, primary: bookingId ? { label: "See what's missing", href: dogPage(bookingId, "before") } : chat }); break;
      case "trainer_report": add({ group: "now", tone: "heart", text: `${trainer} reported an incident with ${dog}`, primary: bookingId ? { label: "Read the report", href: dogPage(bookingId, undefined, "incident-reports") } : chat }); break;
      case "deal_not_booked": {
        const dealId = (i.ref || "").replace(/^deal:/, "");
        add({ group: "now", tone: "biscuit", text: "Closed Won in HubSpot, not booked yet", detail: (i.detail || "").replace(/: Closed Won.*$/, "") || undefined,
          hubspot: hubspotDeal(dealId), primary: /^\d+$/.test(dealId) ? { label: "Book now", href: `/a/bookings/new?deal=${dealId}` } : undefined, doneLabel: "Not a booking" });
        break;
      }
      case "check_vaccines": add({ group: "now", tone: "biscuit", text: `${dog}'s vaccine records came in`, primary: bookingId ? { label: "Check vaccines", href: dogPage(bookingId, "before", "vaccines") } : chat }); break;
      default: add({ group: NOW_KINDS.includes(i.kind) ? "now" : "week", tone: "biscuit", text: `${INCIDENT_LABEL[i.kind] || i.kind}: ${dog}`, primary: chat || (dogHref ? { label: "Open dog", href: dogHref } : undefined) });
    }
  }

  // ── Forms sent in, waiting for review ──
  for (const r of (reps || []) as unknown as { id: string; kind: Kind; week_number: number; booking_id: string; submitted_at: string | null; trainers: { name: string } | null; booking: { dog_name: string | null; client_name: string; hubspot_deal_id: string | null } | null }[]) {
    items.push({
      key: `rep:${r.id}`, group: r.kind === "handover" ? "now" : "week", tone: "biscuit", icon: "form", since: r.submitted_at || undefined,
      text: `${r.trainers?.name || "A trainer"} sent ${r.booking?.dog_name || "a dog"}'s ${kindName(r.kind).toLowerCase()}${r.kind === "weekly" ? ` (week ${r.week_number})` : ""}`,
      detail: r.kind === "handover" ? "Check it, then send it to the client." : undefined,
      primary: { label: "Review", href: `/a/reports/${r.id}` }, dogHref: dogPage(r.booking_id), hubspot: hubspotDeal(r.booking?.hubspot_deal_id)
    });
  }

  // ── Trainer messages ──
  const byTrainer = new Map<string, { n: number; first: string; last: string }>();
  for (const m of (msgs || []) as { trainer_id: string; created_at: string; body: string }[]) {
    const x = byTrainer.get(m.trainer_id) || { n: 0, first: m.created_at, last: "" };
    byTrainer.set(m.trainer_id, { n: x.n + 1, first: x.first, last: m.body });
  }
  for (const [id, x] of byTrainer) items.push({
    key: `msg:${id}`, group: "now", tone: "heart", icon: "message", since: x.first, text: `${tName.get(id) || "A trainer"} sent you ${x.n > 1 ? `${x.n} messages` : "a message"}`,
    detail: x.last.slice(0, 140), primary: { label: "Reply", href: `/a/messages/${id}` }
  });

  // ── Trainer profiles to check, trainers not signed in ──
  for (const t of (trainers || []) as { id: string; name: string; data_flags: string[] | null; active: boolean }[]) {
    if (t.active && t.data_flags?.length) items.push({ key: `flag:${t.id}`, group: "later", tone: "line", icon: "people", text: `Check ${t.name}'s profile`, detail: t.data_flags.join("; "), primary: { label: "Open trainer", href: `/a/trainers/${t.id}` } });
  }
  // Probation: after a new trainer's 4th finished training, an admin approves or declines
  for (const t of (trainers || []) as { id: string; name: string; active: boolean; probation?: string }[]) {
    if (!t.active || t.probation !== "on") continue;
    const { count } = await sb.from("bookings").select("id", { count: "exact", head: true }).eq("trainer_id", t.id).neq("status", "cancelled").lte("end_date", today);
    if ((count || 0) >= 4) items.push({ key: `prob:${t.id}`, group: "week", tone: "biscuit", icon: "people", text: `Approve or decline probation for ${t.name}`, detail: `${count} trainings finished. Their program pay is at 75% until approved.`, primary: { label: "Decide", href: `/a/trainers/${t.id}#probation` } });
  }
  const notIn = signins.filter((s) => !s.lastSignIn);
  if (notIn.length) items.push({
    key: "signin", group: "later", tone: "line", icon: "people", text: `${notIn.length} trainer${notIn.length > 1 ? "s haven't" : " hasn't"} signed in yet`,
    detail: notIn.slice(0, 6).map((s) => s.name).join(", ") + (notIn.length > 6 ? "…" : ""), primary: { label: "Email them", href: "/a/trainers#signin" }
  });

  // ── Background jobs that stopped running (alerts, emails and syncs depend on them) ──
  for (const c of await cronProblems().catch(() => [])) items.push({
    key: `cron:${c.name}`, group: "now", tone: "heart", icon: "alert",
    text: c.lastAt ? `Background job stopped: ${c.label}` : `Background job hasn't run yet: ${c.label}`,
    detail: `${c.lastAt ? `Last ran ${new Date(c.lastAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET.` : ""}${c.error ? ` Error: ${c.error}` : ""} Check Vercel → Crons and the function logs.`.trim()
  });

  // ── Late forms (shown as one group on the page) ──
  const withForms = bookings.filter((b) => b.reports_enabled);
  const rows: RowLike[] = [];
  for (let i = 0; i < withForms.length; i += 150) {
    const { data } = await sb.from("reports").select("id, booking_id, kind, week_number, status, submitted_at, due_by").in("booking_id", withForms.slice(i, i + 150).map((b) => b.id));
    rows.push(...((data || []) as RowLike[]));
  }
  const late = todos(withForms, rows).filter((t) => t.state === "overdue" || t.state === "changes").map((t) => ({ ...t, trainerName: tName.get(t.booking.trainer_id) || "" }));

  const order: Record<TodoGroup, number> = { now: 0, week: 1, later: 2 };
  items.sort((a, b) => order[a.group] - order[b.group] || (a.since || "~").localeCompare(b.since || "~"));
  return { items, late };
}
