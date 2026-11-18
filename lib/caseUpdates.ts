import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { auditSystem } from "./audit";
import { addDealNote, contactDeals, dealContacts, readContacts, searchTickets, updateDeal, updateTicket } from "./hubspot";

// Case updates (migration 062): what the Tower's STEP 8c did from replies to the QA daily email, now done the moment the
// team writes the update on the dog page. No AI: the person says what happened, the app writes it and acts on it.
//  - The note: word for word on the client's deal, "Update from <first name>, <Weekday d Mon>: <their words>".
//  - Actions, only when the person picks them: close the client's open ticket; the client declined the follow-up (Follow Up
//    deal to Not Interested); a follow-up session booked for a date (follow_up_session__1/2/3, and the session's Scheduled
//    stage unless the deal is in Manual Only or Under Review). Before a stage move, skip_fum_automation is ticked so the
//    client gets nothing automated, except a booked session for a client with no Mailer hold and no QA box: then only the
//    date is set and FUM 20 sends the normal booking confirmation, as when the POC books it.
//  - "Needs Sean": it goes under With Sean in the next QA daily until someone marks it settled.

const FUM_PIPELINE = "801784332", NOT_INTERESTED = "1177976356", CONCLUDED = "1177976357", MANUAL_ONLY = "1467103810", UNDER_REVIEW = "1443716415";
const SCHEDULED = ["1177976322", "1177976324", "1180636421"]; // 1st, 2nd, 3rd session scheduled
export type CaseAction = { kind: "close_ticket"; ticketId: string } | { kind: "declined" } | { kind: "session"; n: 1 | 2 | 3 | 0; date: string };

const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", day: "numeric", month: "short" }).replace(",", "");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** The client's Follow Up Management deal, when there's exactly one. */
async function followUpDeal(dealId: string) {
  const contacts = (await dealContacts([dealId])).get(dealId) || [];
  const seen = new Map<string, Record<string, unknown>>();
  for (const c of contacts) for (const d of await contactDeals(c, ["pipeline", "dealstage", "skip_fum_automation", "follow_up_session__1", "follow_up_session__2", "follow_up_session__3", "dealname"])) if (d.properties.pipeline === FUM_PIPELINE) seen.set(d.id, d.properties);
  return { contacts, deals: [...seen.entries()].map(([id, p]) => ({ id, p })) };
}

/** Open tickets that name this client or dog (for the "close ticket" choice). */
export async function openTicketsFor(client: string, dog: string) {
  const first = (client || "").split(" ")[0];
  const found = new Map<string, { id: string; subject: string }>();
  for (const q of [first, dog].filter((x) => x && x.length > 2)) {
    for (const t of await searchTickets(q, [{ propertyName: "hs_pipeline_stage", operator: "EQ", value: "1" }], ["subject", "hs_pipeline_stage"]).catch(() => [])) {
      const subj = String(t.properties.subject || "");
      if (new RegExp(`\\b${first}\\b`, "i").test(subj) || (dog && new RegExp(`\\b${dog}\\b`, "i").test(subj))) found.set(t.id, { id: t.id, subject: subj });
    }
  }
  return [...found.values()];
}

export async function saveCaseUpdate(o: { dealId: string; bookingId?: string | null; client: string; dog: string; text: string; by: string; forSean: boolean; actions: CaseAction[] }, sb: SupabaseClient = serviceClient()) {
  const words = o.text.replace(/\s+/g, " ").trim();
  if (!/^\d+$/.test(o.dealId)) return { ok: false, message: "This dog has no HubSpot deal linked." };
  if (words.length < 3 && !o.actions.length) return { ok: false, message: "Write the update first." };
  const done: { what: string; object: string; objectId: string }[] = [], problems: string[] = [];
  const first = o.by.split(" ")[0];
  let noteId: string | null = null;
  try {
    if (words.length >= 3) noteId = await addDealNote(o.dealId, `Update from ${first}, ${day(new Date())}: ${words}`);
    // Actions
    const needFum = o.actions.some((a) => a.kind !== "close_ticket");
    const fum = needFum ? await followUpDeal(o.dealId) : null;
    for (const a of o.actions) {
      if (a.kind === "close_ticket") { await updateTicket(a.ticketId, { hs_pipeline_stage: "4" }); done.push({ what: "closed the ticket", object: "ticket", objectId: a.ticketId }); continue; }
      if (!fum || fum.deals.length !== 1) { problems.push(fum && fum.deals.length > 1 ? "two follow-up deals: changed neither" : "no follow-up deal found"); continue; }
      const d = fum.deals[0], stage = String(d.p.dealstage || "");
      const quiet = async () => { if (d.p.skip_fum_automation !== "true") { await updateDeal(d.id, { skip_fum_automation: "true" }); d.p.skip_fum_automation = "true"; } };
      if (a.kind === "declined") {
        if (stage === NOT_INTERESTED || stage === CONCLUDED) { problems.push("the follow-up was already closed"); continue; }
        await quiet(); await updateDeal(d.id, { dealstage: NOT_INTERESTED });
        done.push({ what: "follow-up declined: moved to Not Interested", object: "deal", objectId: d.id });
      }
      if (a.kind === "session") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || a.date < today()) { problems.push("the session date is missing or already past"); continue; }
        const n = a.n || ([1, 2, 3] as const).find((k) => !d.p[`follow_up_session__${k}`]) || 0;
        if (!n) { problems.push("all three session dates are already set"); continue; }
        if (d.p[`follow_up_session__${n}`]) { problems.push(`session ${n} already has a date: not changed`); continue; }
        const props = await readContacts(fum.contacts, ["mailer_hold", "qa_flagged"]);
        const held = [...props.values()].some((p) => p.mailer_hold === "true" || p.qa_flagged === "true");
        const move = stage !== MANUAL_ONLY && stage !== UNDER_REVIEW;
        if (held && move) await quiet(); // held client: nothing automated goes out
        await updateDeal(d.id, { [`follow_up_session__${n}`]: a.date, ...(held && move ? { dealstage: SCHEDULED[n - 1] } : {}) });
        done.push({ what: `set session ${n} for ${a.date}${held && move ? " (stage moved quietly)" : move ? " (FUM sends the usual confirmation)" : ""}`, object: "deal", objectId: d.id });
      }
    }
  } catch (e) { problems.push((e as Error).message.slice(0, 200)); }
  const { error } = await sb.from("case_updates").insert({ deal_id: o.dealId, booking_id: o.bookingId || null, client: o.client, dog: o.dog, text: words || "(action only)", by: o.by, note_id: noteId, actions: done, for_sean: o.forSean });
  if (error && /case_updates|schema cache/i.test(error.message)) problems.push("run migration 062 so the QA daily sees it");
  await auditSystem("Case update", `${o.client} (${o.dog}) by ${o.by}: ${words.slice(0, 160)}${done.length ? ` · ${done.map((x) => x.what).join("; ")}` : ""}${o.forSean ? " · for Sean" : ""}`, { link: `https://app.hubspot.com/contacts/21869370/record/0-3/${o.dealId}` }).catch(() => null);
  const msg = [noteId ? "Logged on the deal." : "", done.map((x) => x.what).join("; "), problems.length ? `Not done: ${problems.join("; ")}.` : ""].filter(Boolean).join(" ");
  return { ok: !!(noteId || done.length), message: msg || "Nothing was saved." };
}

export async function recentCaseUpdates(dealId: string, sb: SupabaseClient = serviceClient()) {
  const { data, error } = await sb.from("case_updates").select("id, text, by, at, actions, for_sean, settled_at").eq("deal_id", dealId).order("at", { ascending: false }).limit(10);
  return error ? [] : ((data || []) as { id: string; text: string; by: string; at: string; actions: { what: string }[]; for_sean: boolean; settled_at: string | null }[]);
}
