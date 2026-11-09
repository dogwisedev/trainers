import "server-only";
import { isDemo, serviceClient } from "./supabase";
import { closedWonSince, hubspotConfigured, listOwners, readDeals, type DealProps } from "./hubspot";
import { availability } from "./availability";
import { programFor } from "./programs";
import { addDays, long } from "./dates";
import { etParts } from "./chatRules";
import { buzzOn, md, mdLink, postToBuzz } from "./buzz";
import { claim, claimed, release, startedAt } from "./announce";

// A new Closed Won deal → the Buzz sales channel, side by side with HubSpot's own Slack post (Breeze), and more useful:
// every dog, the money (paid, owed, balance link), the nearest trainers with a free kennel for the whole program and a
// "Book it" link, and a monthly scoreboard. Two ways in, one post per deal:
//   1. HubSpot's webhook (app/api/hubspot/webhook): seconds after a deal's stage changes
//   2. the 30-minute HubSpot sync, as a safety net for anything the webhook missed
// Each deal is claimed in app_state (`sale_announced:<id>`) before posting, so the two can never both post it.
// Only deals won after this went live (`sales_buzz_start`, less an hour) are announced, and only within 3 days of their close date,
// so a cleanup that moves old deals to Closed Won doesn't flood the channel.

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const dealUrl = (id: string) => `https://app.hubspot.com/contacts/21869370/record/0-3/${id}`;
const dollars = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const ordinal = (n: number) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const WINDOW = 3 * 86400e3;

const PROPS = ["dealname", "closedate", "hs_is_closed_won", "hubspot_owner_id", "amount", "amount_paid", "amount_outstanding", "remaining_balance_link",
  "client_name", "client_location", "type_of_program_sold", "program_length__weeks_", "program_start_date",
  "k9___dog_name", "dog_2_name", "dog_3_name", "dog_4_name", "how_many_dogs_need_training_"];

type Booked = { id: string; dog_name: string | null; start_date: string; status: string; trainers: { name: string } | { name: string }[] | null };

/** The sales post for one deal. `deal` saves a read when the caller already has it. */
export async function winMessage(dealId: string, dealIn?: DealProps): Promise<string> {
  const d = dealIn || (await readDeals([dealId], PROPS)).get(dealId);
  if (!d) throw new Error(`deal ${dealId} not found in HubSpot`);
  const dogs = [d.k9___dog_name, d.dog_2_name, d.dog_3_name, d.dog_4_name].map((x) => String(x || "").trim()).filter(Boolean);
  const dogCount = Math.max(1, dogs.length, num(d.how_many_dogs_need_training_));
  const program = programFor(d.type_of_program_sold) || d.type_of_program_sold || "";
  const weeks = num(d.program_length__weeks_);
  const start = /^\d{4}-\d{2}-\d{2}/.test(String(d.program_start_date || "")) ? String(d.program_start_date).slice(0, 10) : null;
  const zip = String(d.client_location || "").match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || null;

  const [booked, ownerName, board] = await Promise.all([
    bookingsFor(dealId), ownerOf(d.hubspot_owner_id), scoreboard(dealId, d)
  ]);

  const what = [program, weeks ? `${weeks} week${weeks === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
  const head = `🎉 **New sale: ${md(dogs.join(" & ") || "dog name not set")}**${what ? ` · ${md(what)}` : ""}`;
  const who = [md(d.client_name || "Client name not set"), d.client_location ? md(d.client_location) : "", start ? `starts ${long(start)}` : "no start date yet"].filter(Boolean).join(" · ");

  const amount = num(d.amount), paid = num(d.amount_paid);
  const owed = d.amount ? Math.max(0, Math.round((amount - paid) * 100) / 100) : num(d.amount_outstanding);
  const money = !d.amount && !d.amount_paid ? "💵 No amount on the deal yet"
    : owed < 0.01 ? `💵 ✅ Paid in full (${dollars(paid || amount)})`
    : `💵 ${dollars(paid)} paid · **${dollars(owed)} owed**${amount ? ` of ${dollars(amount)}` : ""} · ${d.remaining_balance_link ? "balance link ready" : "no balance link yet"}`;

  const book = mdLink("Book it", `${site()}/a/bookings/new?deal=${dealId}`);
  let trainers: string;
  if (booked.length) {
    const t = booked.map((b) => `${mdLink(b.dog_name || "Dog", `${site()}/a/dogs/${b.id}`)} with ${md(trainerName(b) || "no trainer yet")}`);
    trainers = `🐾 Booked: ${t.join(" · ")}`;
  } else trainers = `🐾 ${await freeTrainers(zip, start, weeks, dogCount)} · ${book}`;

  const scores = board ? `🏆 ${md(ownerName || "No owner")} · ${ordinal(board.mine)} win in ${board.month} · team: ${board.count} wins, ${dollars(board.total)}` : `🏆 ${md(ownerName || "No owner")}`;
  return [head, who, money, trainers, `${scores} · ${mdLink("HubSpot deal", dealUrl(dealId))}`].join("\n");
}

const trainerName = (b: Booked) => (Array.isArray(b.trainers) ? b.trainers[0]?.name : b.trainers?.name) || "";

async function bookingsFor(dealId: string): Promise<Booked[]> {
  if (isDemo()) return [];
  const { data } = await serviceClient().from("bookings").select("id, dog_name, start_date, status, trainers(name)").eq("hubspot_deal_id", dealId).neq("status", "cancelled").order("start_date");
  return ((data || []) as unknown as Booked[]).slice(0, 4);
}

async function ownerOf(id: unknown): Promise<string | null> {
  if (!id) return null;
  try { return (await listOwners()).find((o) => o.id === String(id))?.name || null; } catch { return null; }
}

/** Nearest trainers (in range) with enough free kennels for every week of the program, from the app's availability. */
async function freeTrainers(zip: string | null, start: string | null, weeks: number, dogs: number): Promise<string> {
  if (!zip) return "No ZIP on the deal, so no trainer suggestions";
  if (!start) return "No start date yet, so no trainer suggestions";
  try {
    const a = await availability({ zip, routes: false });
    if (!a.ok) return `Trainers: ${md(a.error)}`;
    const first = a.weeks.reduce((idx, w, i) => (w <= start ? i : idx), -1);
    const span = Math.max(1, weeks || 1);
    if (first < 0) return "Starts before this week: check trainers in the app";
    if (first + span > a.weeks.length) return "Starts more than 16 weeks out: too early to suggest trainers";
    const fits = a.trainers.filter((t) => t.inRange && t.free.slice(first, first + span).every((f) => f >= dogs)).slice(0, 3);
    if (!fits.length) return `No trainer in range has ${dogs > 1 ? `${dogs} free kennels` : "a free kennel"} for the whole program`;
    return `Free for the whole program: ${fits.map((t) => `${md(t.name)} (~${t.distance} mi)`).join(" · ")}`;
  } catch (e) { return `Trainers: couldn't check (${md((e as Error).message)})`; }
}

/** This month's wins (by close date, Eastern), counting this deal even if HubSpot's search hasn't caught up with it yet. */
async function scoreboard(dealId: string, d: DealProps): Promise<{ mine: number; count: number; total: number; month: string } | null> {
  try {
    const closed = d.closedate ? new Date(String(d.closedate)) : new Date();
    const ym = etParts(closed).date.slice(0, 7);
    const list = (await closedWonSince(`${ym}-01`, ["amount", "hubspot_owner_id"]))
      .filter((x) => x.properties.closedate && etParts(new Date(String(x.properties.closedate))).date.slice(0, 7) === ym);
    if (!list.some((x) => x.id === dealId)) list.push({ id: dealId, properties: d });
    const owner = String(d.hubspot_owner_id || "");
    return {
      mine: list.filter((x) => owner && String(x.properties.hubspot_owner_id || "") === owner).length || 1,
      count: list.length,
      total: list.reduce((n, x) => n + num(x.properties.amount), 0),
      month: closed.toLocaleString("en-US", { timeZone: "America/New_York", month: "long" })
    };
  } catch { return null; }
}

/** Announce one deal if it's newly Closed Won. Returns what happened (for logs and the webhook's answer). */
export async function announceWin(dealId: string): Promise<string> {
  if (!buzzOn("sales")) return "off";
  if (isDemo() || !hubspotConfigured()) return "not configured";
  const d = (await readDeals([dealId], PROPS)).get(dealId);
  if (!d) return "deal not found";
  if (d.hs_is_closed_won !== "true") return "not won";
  const closed = Date.parse(String(d.closedate || ""));
  if (!closed || Date.now() - closed > WINDOW) return "won more than 3 days ago";
  if (closed < (await startedAt("sales")) - 3600e3) return "won before announcements started"; // an hour of grace on day one
  const key = `sale_announced:${dealId}`;
  if (!(await claim(key))) return "already announced";
  let ok = false;
  try { ok = await postToBuzz("sales", await winMessage(dealId, d)); }
  catch (e) { console.error("sales win", dealId, (e as Error).message); }
  if (!ok) { await release(key); return "not posted (the 30-minute sync will try again)"; }
  return "posted";
}

/** Safety net, from the 30-minute HubSpot sync: wins from the last 3 days that haven't been announced. At most 10 a run. */
export async function announceRecentWins(): Promise<{ posted: number; results: Record<string, string> }> {
  const results: Record<string, string> = {};
  if (!buzzOn("sales") || isDemo() || !hubspotConfigured()) return { posted: 0, results };
  const since = addDays(etParts(new Date()).date, -3);
  const recent = (await closedWonSince(since, ["closedate"])).filter((x) => Date.now() - Date.parse(String(x.properties.closedate || "")) <= WINDOW);
  if (!recent.length) return { posted: 0, results };
  const done = await claimed(recent.map((x) => `sale_announced:${x.id}`));
  for (const x of recent.filter((x) => !done.has(`sale_announced:${x.id}`)).slice(-10)) results[x.id] = await announceWin(x.id);
  return { posted: Object.values(results).filter((r) => r === "posted").length, results };
}

/** For /api/buzz/test: the posts the last `n` Closed Won deals would make, marked TEST. Posts and claims nothing. */
export async function replayRecentWins(n: number): Promise<{ id: string; message: string }[]> {
  if (!hubspotConfigured()) throw new Error("HUBSPOT_TOKEN isn't set");
  const want = Math.min(Math.max(n, 1), 10);
  const since = addDays(etParts(new Date()).date, -45);
  const won = (await closedWonSince(since, ["closedate"])).sort((a, b) => String(b.properties.closedate).localeCompare(String(a.properties.closedate))).slice(0, want);
  const deals = await readDeals(won.map((x) => x.id), PROPS);
  const out: { id: string; message: string }[] = [];
  for (const x of won) {
    const d = deals.get(x.id);
    if (!d) continue;
    const when = new Date(String(d.closedate)).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    out.push({ id: x.id, message: `🧪 **TEST**: a replay of a real sale from ${when} ET. Nothing to do.\n${await winMessage(x.id, d)}` });
  }
  return out;
}
