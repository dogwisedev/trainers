import "server-only";
import { isDemo } from "./supabase";
import { dealsCreatedSince, hubspotConfigured, listOwners, readDeals, type DealProps } from "./hubspot";
import { availability } from "./availability";
import { addDays } from "./dates";
import { etParts } from "./chatRules";
import { buzzOn, md, mdLink, postToBuzz } from "./buzz";
import { claim, claimed, release, startedAt } from "./announce";

// A new Bark lead → the Buzz leads channel, side by side with HubSpot's "Bark Application" Slack post (Breeze), which only
// links the deal. This says whether it's worth chasing before anyone opens HubSpot: the lead score and verdict, why
// (pros, cons, flags), what it cost, what they want, and which trainers have room near them.
// Bark to HubSpot creates the deal, then writes the "Lead intel" properties a few seconds later; HubSpot's webhook fires on
// lead_score, so the post has all of it. One post per deal (app_state `lead_announced:<id>`), only for deals created after
// this went live and in the last 3 days; the 30-minute HubSpot sync posts any the webhook missed, including Bark deals whose
// scoring failed (lead_source Bark, no score), so no Bark lead is ever skipped.
const BARK_LEADS = [[{ propertyName: "lead_score", operator: "HAS_PROPERTY" }], [{ propertyName: "lead_source", operator: "EQ", value: "Bark" }]];

const dealUrl = (id: string) => `https://app.hubspot.com/contacts/21869370/record/0-3/${id}`;
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const WINDOW = 3 * 86400e3;
const VERDICT: Record<string, string> = { buy: "🟢 Buy", consider: "🟡 Consider", check: "🟠 Check", skip: "🔴 Skip", duplicate: "⚪ Duplicate" };

const PROPS = ["dealname", "createdate", "hubspot_owner_id", "city", "state", "lead_source",
  "lead_score", "lead_verdict", "lead_pros", "lead_cons", "lead_flags", "lead_track", "bite_history",
  "nearest_trainer", "trainer_distance_mi", "trainer_in_range", "bark_credits_paid", "bark_pros_before_purchase", "auto_bought",
  "what_is_the_breed_of_the_dog_s__", "what_are_the_dog_s__age_s__", "how_many_dogs_need_training_",
  "which_type_s__of_training_would_you_consider_", "what_type_of_dog_training_do_you_need_", "how_likely_are_you_to_make_a_hiring_decision_"];

const lines = (v: unknown, max: number) => String(v || "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, max).map(md).join(" · ");
const short = (v: unknown, max = 80) => { const s = String(v || "").replace(/\s+/g, " ").trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

export async function leadMessage(dealId: string, dIn?: DealProps): Promise<string> {
  const d = dIn || (await readDeals([dealId], PROPS)).get(dealId);
  if (!d) throw new Error(`deal ${dealId} not found in HubSpot`);
  // Bark deal names are "Name, City, ST, ZIP"
  const [name, ...where] = String(d.dealname || "").split(",").map((x) => x.trim());
  const zip = String(d.dealname || "").match(/\b(\d{5})\b/)?.[1] || null;
  const place = where.length ? where.join(", ") : [d.city, d.state].filter(Boolean).join(", ");
  const dogs = Math.max(1, num(d.how_many_dogs_need_training_));

  const score = d.lead_score ? `**Score ${num(d.lead_score)}/100**` : "No lead score yet";
  const verdict = VERDICT[String(d.lead_verdict || "").toLowerCase()] || "";
  const cost = [
    d.bark_credits_paid ? `${num(d.bark_credits_paid)} credits` : "",
    d.bark_pros_before_purchase !== undefined && d.bark_pros_before_purchase !== null && d.bark_pros_before_purchase !== "" ? `${num(d.bark_pros_before_purchase)} pro${num(d.bark_pros_before_purchase) === 1 ? "" : "s"} bought before us` : "",
    d.auto_bought === "true" ? "auto-bought" : ""
  ].filter(Boolean).join(" · ");

  const dog = [short(d.what_is_the_breed_of_the_dog_s__, 40), short(d.what_are_the_dog_s__age_s__, 30), dogs > 1 ? `${dogs} dogs` : ""].filter(Boolean).map(md).join(", ");
  const wants = short(d.which_type_s__of_training_would_you_consider_ || d.what_type_of_dog_training_do_you_need_, 70);
  const hiring = short(d.how_likely_are_you_to_make_a_hiring_decision_, 40);
  const about = [dog ? `Dog: ${dog}` : "", wants ? `wants: ${md(wants)}` : "", d.lead_track === "bt_conversion" ? "not asking for board & train" : "", hiring ? `hiring: ${md(hiring)}` : ""].filter(Boolean).join(" · ");

  // Bark Buster's flags usually say "Bite history: Yes, …" already; only add our own when they don't
  const flags = [d.bite_history === "true" && !/bite/i.test(String(d.lead_flags || "")) ? "bite history" : "", lines(d.lead_flags, 3)].filter(Boolean).join(" · ");
  const [trainers, owner] = await Promise.all([roomNear(zip, dogs, d), ownerOf(d.hubspot_owner_id)]);

  return [
    `🐕 **New Bark lead: ${md(name || "No name")}**${place ? ` · ${md(place)}` : ""}`,
    [score, verdict, cost].filter(Boolean).join(" · "),
    about,
    d.lead_pros ? `👍 ${lines(d.lead_pros, 2)}` : "",
    d.lead_cons ? `👎 ${lines(d.lead_cons, 2)}` : "",
    flags ? `🚩 ${flags}` : "",
    `🐾 ${trainers}`,
    `${owner ? `Owner: ${md(owner)}` : "No owner yet"} · ${mdLink("HubSpot deal", dealUrl(dealId))}`
  ].filter(Boolean).join("\n");
}

async function ownerOf(id: unknown): Promise<string | null> {
  if (!id) return null;
  try { return (await listOwners()).find((o) => o.id === String(id))?.name || null; } catch { return null; }
}

/** Trainers in range with room in the next 4 weeks (from the app); falls back to Bark Buster's nearest trainer. */
async function roomNear(zip: string | null, dogs: number, d: DealProps): Promise<string> {
  const buster = d.nearest_trainer ? `Nearest: ${md(d.nearest_trainer)}${d.trainer_distance_mi ? ` (~${num(d.trainer_distance_mi)} mi${d.trainer_in_range === "false" ? ", out of range" : ""})` : ""}` : "";
  if (!zip) return buster || "No ZIP, so no trainer check";
  try {
    const a = await availability({ zip, routes: false });
    if (!a.ok) return buster || `Trainers: ${md(a.error)}`;
    const fits = a.trainers.filter((t) => t.inRange && t.free.slice(0, 4).some((f) => f >= dogs)).slice(0, 3);
    if (fits.length) return `Room in the next 4 weeks: ${fits.map((t) => `${md(t.name)} (~${t.distance} mi)`).join(" · ")}`;
    const near = a.trainers.find((t) => t.inRange);
    return near ? `In range but full for 4 weeks: ${md(near.name)} (~${near.distance} mi)` : (buster || "No trainer in range");
  } catch { return buster || "Trainers: couldn't check"; }
}

/** Announce one deal as a new Bark lead, once. */
export async function announceLead(dealId: string): Promise<string> {
  if (!buzzOn("leads")) return "off";
  if (isDemo() || !hubspotConfigured()) return "not configured";
  const d = (await readDeals([dealId], PROPS)).get(dealId);
  if (!d) return "deal not found";
  if (!d.lead_score && d.lead_source !== "Bark") return "not a Bark lead";
  const created = Date.parse(String(d.createdate || ""));
  if (!created || Date.now() - created > WINDOW) return "created more than 3 days ago";
  if (created < (await startedAt("leads")) - 3600e3) return "created before announcements started"; // an hour of grace on day one
  const key = `lead_announced:${dealId}`;
  if (!(await claim(key))) return "already announced";
  let ok = false;
  try { ok = await postToBuzz("leads", await leadMessage(dealId, d)); }
  catch (e) { console.error("lead alert", dealId, (e as Error).message); }
  if (!ok) { await release(key); return "not posted (the 30-minute sync will try again)"; }
  return "posted";
}

/** Safety net, from the 30-minute HubSpot sync: Bark leads from the last 3 days not yet announced. At most 10 a run. */
export async function announceRecentLeads(): Promise<{ posted: number; results: Record<string, string> }> {
  const results: Record<string, string> = {};
  if (!buzzOn("leads") || isDemo() || !hubspotConfigured()) return { posted: 0, results };
  const recent = (await dealsCreatedSince(addDays(etParts(new Date()).date, -3), BARK_LEADS, []))
    .filter((x) => Date.now() - Date.parse(String(x.properties.createdate || "")) <= WINDOW);
  const done = await claimed(recent.map((x) => `lead_announced:${x.id}`));
  for (const x of recent.filter((x) => !done.has(`lead_announced:${x.id}`)).slice(-10)) results[x.id] = await announceLead(x.id);
  return { posted: Object.values(results).filter((r) => r === "posted").length, results };
}

/** For /api/buzz/test: the posts the last `n` Bark leads would make, marked TEST. Posts and claims nothing. */
export async function replayRecentLeads(n: number): Promise<{ id: string; message: string }[]> {
  if (!hubspotConfigured()) throw new Error("HUBSPOT_TOKEN isn't set");
  const want = Math.min(Math.max(n, 1), 10);
  const recent = (await dealsCreatedSince(addDays(etParts(new Date()).date, -7), BARK_LEADS, [])).slice(-want).reverse();
  const deals = await readDeals(recent.map((x) => x.id), PROPS);
  const out: { id: string; message: string }[] = [];
  for (const x of recent) {
    const d = deals.get(x.id);
    if (!d) continue;
    const when = new Date(String(d.createdate)).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    out.push({ id: x.id, message: `🧪 **TEST**: a replay of a real lead from ${when} ET. Nothing to do.\n${await leadMessage(x.id, d)}` });
  }
  return out;
}
