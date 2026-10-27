import "server-only";
import { isDemo, serviceClient } from "./supabase";
import { addDays, daysBetween, weekStart } from "./dates";
import { etParts } from "./chatRules";
import { kindName, todos, type BookingForReports, type RowLike, type Todo } from "./reports";
import { buildTodo } from "./todo";
import { readinessFor } from "./pretraining";
import { availability } from "./availability";
import { dealKey } from "./chatTypes";
import { auditCall } from "./audit";

// The tools behind the app's Claude connector (app/api/mcp/route.ts). Claude calls them through MCP with the
// CLAUDE_MCP_KEY. Each tool reads with the service key, like the admin To do list and the daily email do, so whoever
// holds that key sees what an admin sees. Read only for now. Every call goes in the activity log as done through Claude.

type Args = Record<string, unknown>;
type Field = { type: "string" | "number" | "boolean"; description: string; optional?: boolean };
export type ClaudeTool = { name: string; title: string; description: string; input: Record<string, Field>; run: (a: Args) => Promise<unknown> };

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const link = (path?: string | null) => (path ? (/^https?:\/\//.test(path) ? path : `${site()}${path}`) : undefined);
const today = () => etParts(new Date()).date;
const str = (a: Args, k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");
const isoDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "");
function num(a: Args, k: string, fallback: number, min: number, max: number) {
  const v = a[k];
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}
/** Safe inside a PostgREST or() filter: no commas, brackets or wildcards from the caller. */
const searchText = (s: string) => s.replace(/[,()*%\\:"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
const formName = (t: Pick<Todo, "window">) => `${kindName(t.window.kind)}${t.window.kind === "weekly" ? `, week ${t.window.week}` : ""}`;
const STATE: Record<Todo["state"], string> = {
  overdue: "late", draft: "started, not sent", changes: "sent back for changes", waiting: "sent in, waiting for the team to review",
  open: "open, not started", approved: "approved"
};
const hubspot = (id: string | null | undefined) => (id && /^\d+$/.test(id) ? `https://app.hubspot.com/contacts/21869370/record/0-3/${id}` : undefined);

type BookingRow = {
  id: string; dog_name: string | null; client_name: string; client_email?: string | null; start_date: string; end_date: string; program: string | null;
  weeks: number | null; status: string; trainer_id: string; hubspot_deal_id: string | null; reports_enabled?: boolean | null; trainers?: { name: string } | null;
};
const bookingLine = (b: BookingRow) => ({
  dog: b.dog_name || "Dog", client: b.client_name, trainer: b.trainers?.name || "", pickup: b.start_date, dropoff: b.end_date,
  program: b.program || (b.weeks ? `${b.weeks} weeks` : ""), status: b.status, link: link(`/a/dogs/${b.id}`)
});

/** Forms for these bookings, the same way the trainer's and admin's lists work them out. */
async function formsFor(bookings: BookingRow[]): Promise<(Todo & { trainerName: string })[]> {
  const sb = serviceClient(), rows: RowLike[] = [];
  for (let i = 0; i < bookings.length; i += 150) {
    const { data, error } = await sb.from("reports").select("id, booking_id, kind, week_number, status, submitted_at, due_by").in("booking_id", bookings.slice(i, i + 150).map((b) => b.id));
    if (error) throw new Error(error.message);
    rows.push(...((data || []) as RowLike[]));
  }
  const names = new Map(bookings.map((b) => [b.trainer_id, b.trainers?.name || ""]));
  return todos(bookings as BookingForReports[], rows).map((t) => ({ ...t, trainerName: names.get(t.booking.trainer_id) || "" }));
}
const formLine = (t: Todo & { trainerName: string }) => ({
  dog: t.booking.dog_name || "Dog", client: t.booking.client_name, trainer: t.trainerName, form: formName(t), due: t.window.deadline,
  state: STATE[t.state], daysLate: t.daysLate || undefined, link: link(t.report?.id ? `/a/reports/${t.report.id}` : `/a/dogs/${t.booking.id}`)
});

const CAP = 100;
/** The first CAP rows of a list, and how many there were. */
const capped = <T,>(rows: T[]) => ({ total: rows.length, ...(rows.length > CAP ? { shown: CAP, note: `Showing the first ${CAP}. Narrow it down (a trainer, fewer days) to see the rest.` } : {}), rows: rows.slice(0, CAP) });

const SELECT = "id, dog_name, client_name, start_date, end_date, program, weeks, status, trainer_id, hubspot_deal_id, reports_enabled, trainers(name)";

export const CLAUDE_TOOLS: ClaudeTool[] = [
  {
    name: "todo", title: "To do",
    description: "Everything in the Dogwise app that needs a person now, most urgent first: clients waiting for a reply, trainers who haven't posted, incident reports, forms sent in for review, late forms, unread trainer messages, before-training gaps and booking or HubSpot problems. The same list as the admin To do page.",
    input: {},
    run: async () => {
      const d = await buildTodo();
      return {
        items: d.items.map((i) => ({ when: i.group, what: i.text, detail: i.detail, since: i.since, open: link(i.primary?.href) || link(i.dogHref), hubspot: i.hubspot })),
        lateForms: d.late.map(formLine)
      };
    }
  },
  {
    name: "dogs_in_care", title: "Dogs in care",
    description: "Dogs in care on a day (Eastern time), with trainer, client, dates and program, plus pickups and drop-offs coming up. A booking's drop-off date is the day the dog goes home.",
    input: {
      date: { type: "string", description: "The day, YYYY-MM-DD. Default: today.", optional: true },
      days_ahead: { type: "number", description: "Also list pickups and drop-offs in the next this many days. Default 7, up to 31.", optional: true }
    },
    run: async (a) => {
      const day = isoDate(str(a, "date")) || today(), until = addDays(day, num(a, "days_ahead", 7, 0, 31));
      const { data, error } = await serviceClient().from("bookings").select(SELECT).neq("status", "cancelled").lte("start_date", until).gte("end_date", day).order("start_date");
      if (error) throw new Error(error.message);
      const rows = (data || []) as unknown as BookingRow[];
      return {
        date: day,
        inCare: capped(rows.filter((b) => b.start_date <= day && b.end_date > day).map(bookingLine)),
        pickups: capped(rows.filter((b) => b.start_date >= day && b.start_date <= until).map(bookingLine)),
        dropoffs: capped(rows.filter((b) => b.end_date >= day && b.end_date <= until).map(bookingLine))
      };
    }
  },
  {
    name: "forms", title: "Trainer forms",
    description: "Trainer forms (intake on pickup day, weekly health checks, handover report) that are late, started, sent back, waiting for review or open now. Late weekly checks cost the trainer $100.",
    input: {
      trainer: { type: "string", description: "Only this trainer (name or part of it).", optional: true },
      late_only: { type: "boolean", description: "Only late forms and forms sent back for changes.", optional: true }
    },
    run: async (a) => {
      const sb = serviceClient(), now = today();
      const { data, error } = await sb.from("bookings").select(SELECT).neq("status", "cancelled").gte("end_date", addDays(now, -75));
      if (error) throw new Error(error.message);
      const who = str(a, "trainer").toLowerCase();
      const rows = ((data || []) as unknown as BookingRow[]).filter((b) => !who || (b.trainers?.name || "").toLowerCase().includes(who));
      const lateOnly = a.late_only === true || a.late_only === "true";
      const list = (await formsFor(rows))
        .filter((t) => t.state !== "approved" && t.window.opens <= now)
        .filter((t) => !lateOnly || t.state === "overdue" || t.state === "changes")
        .sort((x, y) => (y.daysLate || 0) - (x.daysLate || 0) || x.window.deadline.localeCompare(y.window.deadline));
      return { forms: capped(list.map(formLine)) };
    }
  },
  {
    name: "before_training", title: "Before training",
    description: "Dogs starting soon and what is still missing before training: the client's forms, vaccine records, food, medication, the remaining balance. Also says if an admin marked the dog OK to start.",
    input: { days: { type: "number", description: "Dogs starting within this many days. Default 14, up to 60.", optional: true } },
    run: async (a) => {
      const now = today(), until = addDays(now, num(a, "days", 14, 1, 60));
      const { data, error } = await serviceClient().from("bookings").select(SELECT).neq("status", "cancelled").gte("start_date", now).lte("start_date", until).order("start_date");
      if (error) throw new Error(error.message);
      const rows = (data || []) as unknown as BookingRow[];
      const ready = await readinessFor(rows.map((b) => b.id));
      return {
        dogs: capped(rows.map((b) => {
          const r = ready.get(b.id);
          return {
            ...bookingLine(b),
            okToStart: r ? r.ready.ready || !!r.dog.cleared : null,
            markedOkBy: r?.dog.cleared?.by || undefined,
            missing: r ? r.ready.missing.map((i) => (i.detail ? `${i.label}: ${i.detail}` : i.label)) : undefined,
            note: r ? undefined : "No before-training details yet (no HubSpot deal, or not synced yet).",
            hubspot: hubspot(b.hubspot_deal_id)
          };
        }))
      };
    }
  },
  {
    name: "find_dog", title: "Find a dog",
    description: "Find bookings by dog or client name (or a HubSpot deal id): dates, trainer, program, status, the dog's chat and its forms. Newest first.",
    input: { query: { type: "string", description: "Dog or client name, or part of it, or a HubSpot deal id." } },
    run: async (a) => {
      const text = searchText(str(a, "query"));
      if (text.length < 2) throw new Error("Give at least 2 letters of the dog's or client's name.");
      const sb = serviceClient();
      const ors = [`dog_name.ilike.%${text}%`, `client_name.ilike.%${text}%`];
      if (/^\d+$/.test(text)) ors.push(`hubspot_deal_id.eq.${text}`);
      const { data, error } = await sb.from("bookings").select(`${SELECT}, client_email`).or(ors.join(",")).order("start_date", { ascending: false }).limit(10);
      if (error) throw new Error(error.message);
      const rows = (data || []) as unknown as BookingRow[];
      if (!rows.length) return { bookings: [] };
      const keys = [...new Set(rows.map((b) => dealKey(b)))];
      const [{ data: chats }, forms] = await Promise.all([
        sb.from("chats").select("id, deal_key, status, last_message_at, last_preview, last_sender, invited_at, closed_at").in("deal_key", keys).order("created_at", { ascending: false }),
        formsFor(rows)
      ]);
      const { data: reps } = await sb.from("reports").select("id, booking_id, kind, week_number, status, submitted_at").in("booking_id", rows.map((b) => b.id)).order("week_number");
      return {
        bookings: rows.map((b) => {
          const chat = ((chats || []) as { id: string; deal_key: string; status: string; last_message_at: string | null; last_preview: string | null; last_sender: string | null; invited_at: string | null; closed_at: string | null }[])
            .filter((c) => c.deal_key === dealKey(b)).sort((x, y) => (x.status === "open" ? -1 : 0) - (y.status === "open" ? -1 : 0))[0];
          return {
            ...bookingLine(b), clientEmail: b.client_email || undefined, hubspot: hubspot(b.hubspot_deal_id),
            chat: chat ? { id: chat.id, status: chat.status, clientInvited: !!chat.invited_at, lastMessageAt: chat.last_message_at, lastFrom: chat.last_sender, lastMessage: chat.last_preview, link: link(`/a/chats/${chat.id}`) } : null,
            formsSent: ((reps || []) as { id: string; booking_id: string; kind: Todo["window"]["kind"]; week_number: number; status: string; submitted_at: string | null }[])
              .filter((r) => r.booking_id === b.id && r.status !== "draft")
              .map((r) => ({ form: `${kindName(r.kind)}${r.kind === "weekly" ? `, week ${r.week_number}` : ""}`, status: r.status, sentAt: r.submitted_at, link: link(`/a/reports/${r.id}`) })),
            formsOwed: forms.filter((t) => t.booking.id === b.id && t.state !== "approved" && t.state !== "waiting" && t.window.opens <= today()).map(formLine)
          };
        })
      };
    }
  },
  {
    name: "chat_messages", title: "Read a dog's chat",
    description: "The latest messages in a dog's chat with the client, the trainer and the Dogwise team, oldest first. Photos and videos are listed by file name.",
    input: {
      chat_id: { type: "string", description: "The chat's id, from find_dog.", optional: true },
      dog: { type: "string", description: "Dog or client name, if you don't have the chat id. The open chat is used first.", optional: true },
      limit: { type: "number", description: "How many messages. Default 30, up to 100.", optional: true }
    },
    run: async (a) => {
      const sb = serviceClient(), id = str(a, "chat_id"), text = searchText(str(a, "dog"));
      type Chat = { id: string; title: string | null; client_name: string | null; trainer_name: string | null; status: string; created_at: string; transcript_url: string | null; archived_at: string | null };
      let chat: Chat | null = null;
      if (/^[0-9a-f-]{36}$/i.test(id)) chat = ((await sb.from("chats").select("id, title, client_name, trainer_name, status, created_at, transcript_url, archived_at").eq("id", id).maybeSingle()).data as Chat | null);
      else if (text.length >= 2) {
        const { data } = await sb.from("chats").select("id, title, client_name, trainer_name, status, created_at, transcript_url, archived_at").or(`title.ilike.%${text}%,client_name.ilike.%${text}%`).order("created_at", { ascending: false }).limit(10);
        const found = (data || []) as Chat[];
        chat = found.find((c) => c.status === "open") || found[0] || null;
      } else throw new Error("Give a chat_id or a dog or client name.");
      if (!chat) return { chat: null, messages: [] };
      const { data, error } = await sb.from("chat_messages").select("sender_role, sender_name, kind, body, media, created_at").eq("chat_id", chat.id).order("created_at", { ascending: false }).limit(num(a, "limit", 30, 1, 100));
      if (error) throw new Error(error.message);
      const msgs = ((data || []) as { sender_role: string; sender_name: string | null; kind: string; body: string | null; media: { name?: string; kind?: string }[] | null; created_at: string }[]).reverse();
      return {
        chat: { id: chat.id, dog: chat.title, client: chat.client_name, trainer: chat.trainer_name, status: chat.status, link: link(`/a/chats/${chat.id}`), transcript: chat.transcript_url || undefined },
        note: chat.archived_at && !msgs.length ? "This chat was closed and archived: its messages are in the transcript in Google Drive." : undefined,
        messages: msgs.map((m) => ({ at: m.created_at, from: m.sender_name || m.sender_role, role: m.sender_role, text: m.body || undefined, files: (m.media || []).map((x) => `${x.kind || "file"}: ${x.name || ""}`.trim()) }))
      };
    }
  },
  {
    name: "availability", title: "Trainer availability",
    description: "Active trainers with free kennels in the next 16 weeks, nearest first when a ZIP is given (with whether the client is inside the trainer's driving range). soonestStart is the first week (starting Sunday) a 2, 3 or 4 week program could begin. With a start date and length, freeForProgram says whether the trainer has a kennel free for every week of it.",
    input: {
      zip: { type: "string", description: "The client's 5-digit US ZIP code.", optional: true },
      start: { type: "string", description: "Training start date, YYYY-MM-DD.", optional: true },
      weeks: { type: "number", description: "Program length in weeks. Default 3.", optional: true },
      limit: { type: "number", description: "How many trainers. Default 10, up to 50.", optional: true }
    },
    run: async (a) => {
      const zip = str(a, "zip"), start = isoDate(str(a, "start")), weeks = num(a, "weeks", 3, 1, 12);
      const r = await availability({ zip: /^\d{5}$/.test(zip) ? zip : "" });
      if (!r.ok) throw new Error(r.error);
      const idx = start ? daysBetween(r.weeks[0], weekStart(start)) / 7 : null;
      const list = r.trainers.map((t) => ({
        name: t.name, where: [t.city, t.state].filter(Boolean).join(", "), milesAway: t.distance ?? undefined, coversThisClient: t.inRange ?? undefined,
        rangeMiles: t.range, kennels: t.capacity, freeThisWeek: t.freeNow, away: t.awayNow || undefined,
        soonestStart: { twoWeeks: t.soon2, threeWeeks: t.soon3, fourWeeks: t.soon4 },
        freeForProgram: idx === null ? undefined : idx < 0 || idx + weeks > t.free.length ? "can't tell (outside the next 16 weeks)" : t.free.slice(idx, idx + weeks).every((f) => f > 0),
        programs: t.programs || undefined, notes: t.notes || undefined
      }));
      const ordered = idx === null ? list : [...list].sort((x, y) => Number(y.freeForProgram === true) - Number(x.freeForProgram === true));
      return { origin: r.origin, start: start || undefined, weeks: start ? weeks : undefined, trainers: ordered.slice(0, num(a, "limit", 10, 1, 50)) };
    }
  }
];

/** JSON Schema for a tool's arguments, as MCP's tools/list wants it. */
export function toolInputSchema(t: ClaudeTool) {
  const properties = Object.fromEntries(Object.entries(t.input).map(([k, f]) => [k, { type: f.type, description: f.description }]));
  const required = Object.entries(t.input).filter(([, f]) => !f.optional).map(([k]) => k);
  return { type: "object" as const, properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

/** Runs one tool for the connector and logs it. Never throws. */
export async function runClaudeTool(name: string, args: Args): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const tool = CLAUDE_TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `No tool called "${name}". Tools: ${CLAUDE_TOOLS.map((t) => t.name).join(", ")}.` };
  if (isDemo()) return { ok: false, error: "The app is in demo mode (no database), so there is nothing to read." };
  const who = { name: "Claude connector", role: "claude" };
  const logged = Object.fromEntries(Object.entries(args).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)));
  try {
    const result = await tool.run(args);
    await auditCall("claudeTool", { tool: name, ...logged }, who, { ok: true });
    return { ok: true, result };
  } catch (e) {
    const error = (e as Error)?.message || "Something went wrong";
    await auditCall("claudeTool", { tool: name, ...logged }, who, { ok: false, error });
    return { ok: false, error };
  }
}
