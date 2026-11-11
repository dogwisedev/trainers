import "server-only";
import { cache } from "react";
import { isPayMonday, periodLabel } from "./payroll";
import { todayIso } from "./dates";
import { serviceClient, isDemo } from "./supabase";
import { addDays, short } from "./dates";
import { etParts, INCIDENT_LABEL, IncidentKind } from "./chatRules";
import { BookingForReports, Kind, RowLike, Todo, kindName, todos } from "./reports";
import { trainerSignins } from "./trainerSignin";
import { dealKey } from "./chatTypes";
import { cronProblems } from "./cronHealth";
import { notAProgram, programFor } from "./programs";
import { dayName, historyLines, openNudges, suggestCheckIn, type ChaseInfo, type Nudge, type NudgeKind } from "./nudges";
import { quoConfigured, toE164 } from "./quo";
import { ruleNeeds } from "./clientNeeds";

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
  quietChatId?: string; // a chat alert that Quiet chat would silence (finishing on Signal)
  deal?: string;        // a Closed Won deal to decide on: the row offers Book now / Standby / Cancelled instead of Done
  booking?: { id: string; move: "pickup" | "dropoff" | null; dog: string; trainer: string; hasDeal: boolean };
  ask?: { id: string; kind: "offer" | "pedro"; expired: boolean; trainer: string; dealId: string }; // Assign or Ask: check with the trainer / Ask Pedro // a booked dog that didn't start / finish as planned: Mark / Postpone / Cancel
  poc?: string;         // the trainer's Point of Contact (from the trainer's profile), for the POC filter; none = not tied to a trainer
  chase?: ChaseInfo;
  clear?: "noreply" | "handled";
  readTrainer?: string; // a trainer's message: "No reply needed" marks their thread read // a client item a person can close: "No reply needed" (waiting) / "Handled" (office question, urgent)    // handed to the office by the reminder ladder: history, a suggested check-in, Send in app / Text / Call (no Done: it clears itself)
};
/** late: forms past their deadline. beforeApp: handover reports due before the app took over the forms (still needed for the certificate). */
export type TodoData = { items: TodoItem[]; late: (Todo & { trainerName: string; poc?: string })[]; beforeApp: (Todo & { trainerName: string; poc?: string })[]; pocs: string[] };

export const hubspotDeal = (id: string | null | undefined) => (id && /^\d+$/.test(id) ? `https://app.hubspot.com/contacts/21869370/record/0-3/${id}` : undefined);
export const dogPage = (bookingId: string, tab?: string, hash?: string) => `/a/dogs/${bookingId}${tab ? `?tab=${tab}` : ""}${hash ? `#${hash}` : ""}`;

type Inc = {
  id: string; kind: IncidentKind; status: string; detail: string | null; opened_at: string; chat_id: string | null; booking_id: string | null; report_id: string | null; ref: string | null;
  chat: { id: string; title: string | null; client_name: string | null; trainer_name: string | null; trainer_id?: string | null; deal_key: string } | null;
  booking: { id: string; dog_name: string | null; client_name: string; start_date: string; hubspot_deal_id: string | null; trainer_id: string; trainers: { name: string } | null } | null;
};
type B = BookingForReports & { hubspot_deal_id: string | null; reports_enabled?: boolean | null };

const NOW_KINDS: IncidentKind[] = ["trainer_report", "client_waiting", "client_pileup", "trainer_silent", "check_vaccines", "booking_cancelled", "length_changed", "overbooked"];

/** To do, worked out once per page load (the menu badge and the To do page use the same list, so the numbers always match). */
export const buildTodo = cache(buildTodoUncached);
/** The number on the To do badge and at the top of To do: every row, with the handovers from before the app counted as one row (as shown).
 *  Late forms aren't counted: the app reminds the trainers (lib/nudges.ts), and a form still late after 2 reminders is its own row. */
export const todoTotal = (d: TodoData) => d.items.length + (d.beforeApp.length ? 1 : 0);
export async function todoCount(): Promise<number> { return todoTotal(await buildTodo()); }

async function buildTodoUncached(): Promise<TodoData> {
  if (isDemo()) return { items: [], late: [], beforeApp: [], pocs: [] };
  const sb = serviceClient(), today = etParts(new Date()).date;
  const [{ data: incs }, { data: reps }, { data: msgs }, { data: trainers }, signins, { data: bks }] = await Promise.all([
    sb.from("chat_incidents").select("id, kind, status, detail, opened_at, chat_id, booking_id, report_id, ref, chat:chats(id, title, client_name, trainer_name, trainer_id, deal_key), booking:bookings!booking_id(id, dog_name, client_name, start_date, hubspot_deal_id, trainer_id, trainers(name))").neq("status", "resolved").order("opened_at"),
    sb.from("reports").select("id, kind, week_number, booking_id, submitted_at, trainer_id, trainers(name), booking:bookings!booking_id(dog_name, client_name, hubspot_deal_id)").eq("status", "submitted").order("submitted_at"),
    sb.from("messages").select("trainer_id, created_at, body").eq("sender_role", "trainer").is("read_at", null).order("created_at"),
    sb.from("trainers").select("id, name, data_flags, active, probation, poc, phone"),
    trainerSignins().catch(() => []),
    sb.from("bookings").select("id, trainer_id, client_name, dog_name, start_date, end_date, weeks, status, reports_enabled, hubspot_deal_id").neq("status", "cancelled").gte("end_date", addDays(today, -75))
  ]);
  const bookings = (bks || []) as B[];
  const tName = new Map(((trainers || []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  // Point of Contact per trainer (free text on the trainer's profile): the To do POC filter
  const tPoc = new Map(((trainers || []) as { id: string; poc: string | null }[]).map((t) => [t.id, String(t.poc || "").replace(/\s+/g, " ").trim()]));
  const pocOf = (trainerId: string | null | undefined) => (trainerId && tPoc.get(trainerId)) || undefined;
  const askIds = ((incs || []) as { ref: string | null }[]).map((i) => (i.ref || "").match(/^ask(?:-expired)?:(.+)$/)?.[1]).filter(Boolean) as string[];
  const { data: askRows } = askIds.length ? await serviceClient().from("booking_asks").select("id, kind, trainer_id, deal_id").in("id", askIds) : { data: [] };
  const askOf = new Map(((askRows || []) as { id: string; kind: "offer" | "pedro"; trainer_id: string; deal_id: string }[]).map((a) => [a.id, a]));
  const bookingOfKey = (key: string) => bookings.find((b) => dealKey(b) === key);
  const items: TodoItem[] = [];

  // The reminder ladder (lib/nudges.ts): what the app already sent, for the items it handed to the office
  const nudges = await openNudges(sb).catch(() => [] as Nudge[]);
  const nudgesOf = new Map<string, Nudge[]>();
  for (const n of nudges) nudgesOf.set(n.ref, [...(nudgesOf.get(n.ref) || []), n]);
  const tPhone = new Map(((trainers || []) as { id: string; phone: string | null }[]).map((t) => [t.id, t.phone]));
  const canText = quoConfigured();
  const chaseFor = (i: Inc, kind: NudgeKind, o: { trainerId?: string | null; trainer: string; dog: string; client: string; bookingId?: string }): ChaseInfo | undefined => {
    if (!o.trainerId) return undefined;
    let ref = (i.ref || "").startsWith("nudge:") ? i.ref!.slice(6) : null;
    if (!ref && i.chat_id) ref = nudges.filter((n) => n.chat_id === i.chat_id && n.kind === kind).sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0]?.ref || null;
    const rows = ref ? nudgesOf.get(ref) || [] : [], bits = (ref || "").split(":");
    const since = kind === "update_due" && bits[2] ? (bits[2] === "none" ? "pickup" : dayName(bits[2])) : undefined;
    const firstAt = kind === "client_waiting" && ref ? ref.slice(ref.indexOf(":", 8) + 1) : "";
    const hours = firstAt && Date.parse(firstAt) ? Math.max(1, Math.round((Date.now() - Date.parse(firstAt)) / 3600e3)) : undefined;
    const form = kind === "form_late" && bits[2] ? `the ${kindName(bits[2] as Kind).toLowerCase()}${bits[2] === "weekly" ? ` (week ${bits[3]})` : ""}` : undefined;
    const phone = tPhone.get(o.trainerId) || null;
    return { ref, kind, trainerId: o.trainerId, trainerName: o.trainer, phone, chatId: i.chat_id, bookingId: o.bookingId || null,
      history: historyLines(rows), suggested: suggestCheckIn(kind, { trainer: o.trainer, dog: o.dog, client: o.client, since, hours, form }), canText: canText && !!toE164(phone) };
  };

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
    const base = { key: `inc:${i.id}`, since: i.opened_at, incidentId: i.id, dogHref, hubspot: deal, detail: i.detail || undefined, poc: pocOf(i.booking?.trainer_id || bk?.trainer_id || i.chat?.trainer_id) };
    const ICON: Partial<Record<IncidentKind, TodoIcon>> = { client_waiting: "chat", client_pileup: "chat", trainer_silent: "chat", reopened: "chat", ready_to_close: "chat",
      intake_media_missing: "camera", handover_photo_missing: "camera", overbooked: "dog", length_changed: "money", booking_cancelled: "money", hubspot_problem: "deal",
      not_ready: "dog", check_vaccines: "vaccine", trainer_report: "alert" };
    const add = (o: Omit<TodoItem, "key" | "since" | "incidentId" | "dogHref" | "hubspot"> & Partial<TodoItem>) => items.push({ ...base, icon: ICON[i.kind] || "alert", ...o });
    switch (i.kind) {
      case "client_waiting": add({ group: "now", tone: "heart", text: `${client} is waiting for a reply about ${dog}`, primary: chat ? { ...chat, label: "Reply" } : undefined, quietChatId: i.chat_id || undefined, clear: "noreply",
        chase: chaseFor(i, "client_waiting", { trainerId: i.chat?.trainer_id, trainer, dog, client, bookingId }) }); break;
      case "client_pileup": add({ group: "now", tone: "heart", text: `${client} has sent several messages about ${dog}`, primary: chat ? { ...chat, label: "Reply" } : undefined, quietChatId: i.chat_id || undefined, clear: "noreply",
        chase: chaseFor(i, "client_waiting", { trainerId: i.chat?.trainer_id, trainer, dog, client, bookingId }) }); break;
      // Read by the app (lib/clientNeeds.ts): for the office to answer in the chat, or Handled (answered by phone or email)
      case "client_office": add({ group: "now", tone: "biscuit", text: `${client} asked the office about ${dog}`, detail: (i.detail || "").replace(/^.*? asked the office: /, ""), primary: chat ? { ...chat, label: "Reply" } : undefined, clear: "handled" }); break;
      case "client_urgent": add({ group: "now", tone: "heart", text: `${client}: a message about ${dog} needs a person now`, detail: (i.detail || "").replace(/^[^:]*: /, ""), primary: chat ? { ...chat, label: "Reply" } : undefined, clear: "handled" }); break;
      case "trainer_silent": {
        // From the reminder ladder: 2 days with no post, after 2 reminders. (Before it: a flag every evening with no post.)
        const fromLadder = (i.ref || "").startsWith("nudge:");
        add({ group: "now", tone: "heart", text: fromLadder ? `${trainer} hasn't posted about ${dog} for 2 days` : `${trainer} hasn't posted about ${dog} today`,
          detail: (i.detail || "").replace(/\s*Reminded .*$/, "") || undefined, primary: chat, quietChatId: i.chat_id || undefined,
          chase: chaseFor(i, "update_due", { trainerId: i.chat?.trainer_id, trainer, dog, client, bookingId }) });
        break;
      }
      case "form_chase": {
        const bits = (i.ref || "").split(":"), kind = bits[3] as Kind | undefined;
        const form = kind ? `${kindName(kind).toLowerCase()}${kind === "weekly" ? ` (week ${bits[4]})` : ""}` : "form";
        add({ group: "now", tone: "biscuit", icon: "form", text: `${trainer} hasn't sent ${dog}'s ${form}`, detail: (i.detail || "").replace(/\s*Reminded .*$/, "") || undefined,
          primary: dogHref ? { label: "Open dog", href: dogHref } : undefined, chase: chaseFor(i, "form_late", { trainerId: i.booking?.trainer_id || bk?.trainer_id, trainer, dog, client, bookingId }) });
        break;
      }
      case "reopened": add({ group: "week", tone: "biscuit", text: `${client} started a new chat about ${dog}`, primary: chat }); break;
      case "ready_to_close": add({ group: "week", tone: "line", text: `${dog}'s chat can be closed`, primary: chat ? { ...chat, label: "Open chat to close" } : undefined }); break;
      case "intake_media_missing": add({ group: "week", tone: "biscuit", text: `${dog}'s intake form came in without pickup photos or video`, primary: chat }); break;
      case "handover_photo_missing": add({ group: "week", tone: "biscuit", text: `${dog}'s handover has no photo with the trainer`, primary: i.report_id ? { label: "Open form", href: `/a/reports/${i.report_id}` } : chat }); break;
      case "overbooked": add({ group: "now", tone: "heart", text: `${trainer} has more dogs than kennels`, primary: i.booking ? { label: "Open trainer", href: `/a/trainers/${i.booking.trainer_id}` } : undefined }); break;
      case "length_changed": add({ group: "now", tone: "heart", text: `${dog}'s program length changed: check pay and refund`, primary: deal ? { label: "HubSpot deal", href: deal, external: true } : undefined }); break;
      case "booking_cancelled": add({ group: "now", tone: "heart", text: `${dog}'s training was cancelled: refund or partial pay?`, primary: deal ? { label: "HubSpot deal", href: deal, external: true } : undefined }); break;
      case "hubspot_problem":
        if ((i.ref || "").startsWith("dogname:")) {
          // A dog name on the deal that looks like two dogs, or like a person (lib/dogNames.ts)
          const name = (i.detail || "").match(/^"(.+?)"/)?.[1] || dog, two = /two dogs/.test(i.detail || "");
          add({ group: startsSoon ? "now" : "week", tone: "biscuit", icon: "dog", text: two ? `Looks like 2 dogs in one name: ${name}` : `Dog name looks like a person's: ${name}`,
            detail: `${client}. ${two ? "Put each dog in its own name box (Dog 1, Dog 2…) on the deal." : "Fix the dog's name on the deal."} The app follows within 30 minutes. If the name is right, press Keep dog name.`,
            primary: deal ? { label: "Fix in HubSpot", href: deal, external: true } : undefined, doneLabel: "Keep dog name" });
          break;
        }
        // No start date on the deal usually means it's moved or stalled: offer Postpone (Standby) and Cancel right here
        { const noStart = /no program start date/i.test(i.detail || "");
          add({ group: noStart ? "now" : "week", tone: "biscuit", text: noStart ? `${dog}'s deal has no start date: postponed?` : `Check ${dog}'s HubSpot deal`, primary: deal ? { label: "HubSpot deal", href: deal, external: true } : dogHref ? { label: "Open dog", href: dogHref } : undefined,
            booking: noStart && bookingId && i.booking ? { id: bookingId, move: null, dog, trainer, hasDeal: !!i.booking.hubspot_deal_id } : undefined }); }
        break;
      case "not_ready": add({ group: startsSoon ? "now" : "week", tone: "heart", detail: (i.detail || "").replace(/^.*?isn't ready:\s*/, "Missing: ").replace(/\.$/, "") || undefined, text: `${dog} starts ${i.booking ? short(i.booking.start_date) : "soon"} and isn't ready`, primary: bookingId ? { label: "See what's missing", href: dogPage(bookingId, "before") } : chat }); break;
      case "trainer_report": add({ group: "now", tone: "heart", text: `${trainer} reported an incident with ${dog}`, primary: bookingId ? { label: "Read the report", href: dogPage(bookingId, undefined, "incident-reports") } : chat }); break;
      case "standby_reminder": {
        const dealId = (i.ref || "").replace(/^standby:/, "");
        add({ group: "now", tone: "biscuit", text: "Standby: time to check", detail: i.detail || undefined, hubspot: hubspotDeal(dealId), deal: /^\d+$/.test(dealId) ? dealId : undefined });
        break;
      }
      case "deal_not_booked": {
        const dealId = (i.ref || "").replace(/^deal:/, "");
        const again = /cancelled in the app/i.test(i.detail || "");
        add({ group: "now", tone: "biscuit", text: again ? "Cancelled in the app, still Closed Won in HubSpot" : "Closed Won in HubSpot, not booked yet",
          detail: (i.detail || "").replace(/: (Closed Won|cancelled in the app).*$/, "") || undefined,
          hubspot: hubspotDeal(dealId), deal: /^\d+$/.test(dealId) ? dealId : undefined });
        break;
      }
      case "trainer_offer": case "ask_pedro": {
        const m = (i.ref || "").match(/^ask(-expired)?:(.+)$/), a = m ? askOf.get(m[2]) : undefined, expired = !!m?.[1];
        const who = a ? tName.get(a.trainer_id) || "the trainer" : "";
        add({ group: "now", tone: "biscuit", icon: i.kind === "ask_pedro" ? "people" : "message",
          text: i.kind === "ask_pedro" ? (a ? `Ask Pedro: can ${who} take it?` : "For Pedro: a trainer silent on two offers") : expired ? `No reply from ${who}: re-match` : `Check with ${who} before booking`,
          detail: i.detail || undefined, poc: a ? pocOf(a.trainer_id) : undefined, hubspot: a ? hubspotDeal(a.deal_id) : undefined,
          ask: a ? { id: a.id, kind: a.kind, expired, trainer: who, dealId: a.deal_id } : undefined });
        break;
      }
      case "pickup_unconfirmed": case "dropoff_unconfirmed": {
        const move = i.kind === "pickup_unconfirmed" ? "pickup" : "dropoff";
        add({ group: "now", tone: "heart", icon: "dog", text: move === "pickup" ? `${dog}'s pickup isn't confirmed` : `${dog}'s drop-off isn't confirmed`, detail: i.detail || undefined, primary: dogHref ? { label: "Dog", href: dogHref } : undefined,
          booking: bookingId ? { id: bookingId, move, dog, trainer, hasDeal: !!i.booking?.hubspot_deal_id } : undefined });
        break;
      }
      case "followup_request": add({ group: "now", tone: "biscuit", icon: "chat", text: `${client} asked for a follow-up session for ${dog}, not confirmed yet`, detail: i.detail || undefined, primary: dogHref ? { label: "Open dog", href: dogPage(bookingId!, undefined, "followups") } : chat }); break;
      case "followup_report": add({ group: "week", tone: "line", icon: "form", text: `${trainer} hasn't logged ${dog}'s follow-up session`, detail: i.detail || undefined, primary: dogHref ? { label: "Open dog", href: dogPage(bookingId!, undefined, "followups") } : chat }); break;
      case "check_vaccines": add({ group: "now", tone: "biscuit", text: `${dog}'s vaccine records came in`, primary: bookingId ? { label: "Check vaccines", href: dogPage(bookingId, "before", "vaccines") } : chat }); break;
      default: add({ group: NOW_KINDS.includes(i.kind) ? "now" : "week", tone: "biscuit", text: `${INCIDENT_LABEL[i.kind] || i.kind}: ${dog}`, primary: chat || (dogHref ? { label: "Open dog", href: dogHref } : undefined) });
    }
  }

  // ── Forms sent in, waiting for review ──
  for (const r of (reps || []) as unknown as { id: string; kind: Kind; week_number: number; booking_id: string; submitted_at: string | null; trainer_id: string | null; trainers: { name: string } | null; booking: { dog_name: string | null; client_name: string; hubspot_deal_id: string | null } | null }[]) {
    items.push({
      key: `rep:${r.id}`, group: r.kind === "handover" ? "now" : "week", tone: "biscuit", icon: "form", since: r.submitted_at || undefined, poc: pocOf(r.trainer_id),
      text: `${r.trainers?.name || "A trainer"} sent ${r.booking?.dog_name || "a dog"}'s ${kindName(r.kind).toLowerCase()}${r.kind === "weekly" ? ` (week ${r.week_number})` : ""}`,
      detail: r.kind === "handover" ? "Check it, then send it to the client." : undefined,
      primary: { label: "Review", href: `/a/reports/${r.id}` }, dogHref: dogPage(r.booking_id), hubspot: hubspotDeal(r.booking?.hubspot_deal_id)
    });
  }

  // ── Trainer messages ──
  // A 👍, "ok" or "thanks" isn't a task: it stays unread in Messages, but only threads with something to answer are on To do
  const byTrainer = new Map<string, { n: number; first: string; last: string; real: boolean }>();
  for (const m of (msgs || []) as { trainer_id: string; created_at: string; body: string }[]) {
    const x = byTrainer.get(m.trainer_id) || { n: 0, first: m.created_at, last: "", real: false };
    byTrainer.set(m.trainer_id, { n: x.n + 1, first: x.first, last: m.body, real: x.real || ruleNeeds(m.body, "text").needs !== "none" });
  }
  for (const [id, x] of byTrainer) if (x.real) items.push({ readTrainer: id,
    key: `msg:${id}`, group: "now", tone: "heart", icon: "message", since: x.first, poc: pocOf(id), text: `${tName.get(id) || "A trainer"} sent you ${x.n > 1 ? `${x.n} messages` : "a message"}`,
    detail: x.last.slice(0, 140), primary: { label: "Reply", href: `/a/messages/${id}` }
  });

  // ── Trainer profiles to check, trainers not signed in ──
  for (const t of (trainers || []) as { id: string; name: string; data_flags: string[] | null; active: boolean }[]) {
    if (t.active && t.data_flags?.length) items.push({ key: `flag:${t.id}`, group: "later", tone: "line", icon: "people", poc: pocOf(t.id), text: `Check ${t.name}'s profile`, detail: t.data_flags.join("; "), primary: { label: "Open trainer", href: `/a/trainers/${t.id}` } });
  }
  // Probation: after a new trainer's 4th finished training, an admin approves or declines
  for (const t of (trainers || []) as { id: string; name: string; active: boolean; probation?: string }[]) {
    if (!t.active || t.probation !== "on") continue;
    const { count } = await sb.from("bookings").select("id", { count: "exact", head: true }).eq("trainer_id", t.id).neq("status", "cancelled").lte("end_date", today);
    if ((count || 0) >= 4) items.push({ key: `prob:${t.id}`, group: "week", tone: "biscuit", icon: "people", poc: pocOf(t.id), text: `Approve or decline probation for ${t.name}`, detail: `${count} trainings finished. Their program pay is at 75% until approved.`, primary: { label: "Decide", href: `/a/trainers/${t.id}#probation` } });
  }
  const notIn = signins.filter((s) => !s.lastSignIn);
  if (notIn.length) items.push({
    key: "signin", group: "later", tone: "line", icon: "people", text: `${notIn.length} trainer${notIn.length > 1 ? "s haven't" : " hasn't"} signed in yet`,
    detail: notIn.slice(0, 6).map((s) => s.name).join(", ") + (notIn.length > 6 ? "…" : ""), primary: { label: "Email them", href: "/a/trainers#signin" }
  });

  // ── Dogs whose program isn't clear (e.g. booked as "4-week"): no training materials and a vague certificate until it's set ──
  {
    const { data: unclear, error: uErr } = await sb.from("bookings").select("id, trainer_id, dog_name, client_name, program, program_choice, start_date")
      .neq("status", "cancelled").gte("end_date", today).not("hubspot_deal_id", "is", null).limit(500);
    if (!uErr) for (const b of (unclear || []) as { id: string; trainer_id: string | null; dog_name: string | null; client_name: string; program: string | null; program_choice: string | null; start_date: string }[]) {
      if (programFor(b.program_choice || "") || programFor(b.program || "") || notAProgram(b.program)) continue;
      items.push({ key: `program:${b.id}`, group: b.start_date <= addDays(today, 7) ? "now" : "week", tone: "biscuit", icon: "dog", poc: pocOf(b.trainer_id),
        text: `Set the program for ${b.dog_name || "the dog"}`, detail: `${b.client_name}: booked as "${b.program || "no program"}". Pick one of the 7 programs so training materials go out.`,
        dogHref: `/a/dogs/${b.id}`, primary: { label: "Set program", href: `/a/dogs/${b.id}#program` } });
    }
  }

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
  const forms = todos(withForms, rows).map((t) => ({ ...t, trainerName: tName.get(t.booking.trainer_id) || "", poc: pocOf(t.booking.trainer_id) }));
  const late = forms.filter((t) => !t.beforeApp && (t.state === "overdue" || t.state === "changes"));
  const beforeApp = forms.filter((t) => t.beforeApp && t.state !== "waiting");

  const order: Record<TodoGroup, number> = { now: 0, week: 1, later: 2 };
  items.sort((a, b) => order[a.group] - order[b.group] || (a.since || "~").localeCompare(b.since || "~"));
  // Payslips waiting for approval: one small count, not the whole pay run
  if (!isDemo()) {
    const { data: drafts } = await sb.from("payslips").select("id, pay_runs(submit_date, period_start, period_end)").eq("status", "draft").limit(200);
    const list = (drafts || []) as unknown as { pay_runs: { submit_date: string; period_start: string; period_end: string } | null }[];
    if (list.length) {
      const r = list.map((x) => x.pay_runs).filter(Boolean).sort((a, b) => a!.submit_date.localeCompare(b!.submit_date))[0];
      items.push({ key: "pay", group: isPayMonday(todayIso()) ? "now" : "week", tone: "biscuit", icon: "pay", text: `${list.length} payslip${list.length > 1 ? "s" : ""} to approve`, detail: r ? periodLabel(r.period_start, r.period_end) : undefined, primary: { label: "Open payslips", href: "/a/trainers?view=pay" } });
    }
  }
  // Every POC written on an active trainer's profile, for the filter (even ones with nothing on To do right now)
  const pocs = [...new Map(((trainers || []) as { active: boolean; poc: string | null }[]).filter((t) => t.active).map((t) => String(t.poc || "").replace(/\s+/g, " ").trim()).filter(Boolean).map((p) => [p.toLowerCase(), p] as const)).values()].sort((a, b) => a.localeCompare(b));
  return { items, late, beforeApp, pocs };
}
