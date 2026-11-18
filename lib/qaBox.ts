import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { auditSystem } from "./audit";
import { contactDeals, dealContacts, readContacts, searchContacts, updateContact, updateDeal } from "./hubspot";

// The QA box (migration 061), as the Tower's STEP 8d did it, now the moment someone flags a client in the app:
//  1. the client's contacts on the deal, plus duplicates that share their email or phone;
//  2. qa_flagged = true and mailer_hold = true on each that isn't already (never unticks anything);
//  3. their open Follow Up Management deal (pipeline 801784332) moves to Manual Only, but only from In Conversation, Outreach,
//     No Response or Waiting on Client, and only when skip_fum_automation isn't already true;
//  4. checked again 20 minutes and a day later: mailer_hold set if missing, a live Mailer sequence parked, a Follow Up deal
//     that slipped back out of Manual Only moved back.
// No AI: every step is a rule. Anything that fails is recorded on the flag, and the check retries it.

const FUM_PIPELINE = "801784332", MANUAL_ONLY = "1467103810";
const FUM_LIVE = ["1443716414", "1257063731", "1177976327", "1477408600"]; // In Conversation, Outreach, No Response, Waiting on Client
export const QA_REASONS = ["Complaint", "Needs support", "Behavior, safety or health", "Program or pickup to review", "Refund, cancellation or dispute", "Other"];
const digits10 = (p: unknown) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };

/** The client's contact ids: on the deal, plus records that share an email or a phone with them (the same person twice). */
async function clientContacts(dealId: string): Promise<string[]> {
  const onDeal = (await dealContacts([dealId])).get(dealId) || [];
  if (!onDeal.length) return [];
  const props = await readContacts(onDeal, ["email", "phone", "mobilephone"]);
  const ids = new Set(onDeal);
  for (const [, p] of props) {
    const groups: { propertyName: string; operator: string; value: string }[][] = [];
    if (p.email) groups.push([{ propertyName: "email", operator: "EQ", value: String(p.email).toLowerCase() }]);
    for (const ph of [digits10(p.phone), digits10(p.mobilephone)].filter(Boolean)) {
      groups.push([{ propertyName: "hs_searchable_calculated_phone_number", operator: "EQ", value: ph }]);
      groups.push([{ propertyName: "hs_searchable_calculated_mobile_number", operator: "EQ", value: ph }]);
    }
    for (const r of await searchContacts(groups, ["email"]).catch(() => [])) ids.add(r.id);
  }
  return [...ids];
}

/** Ticks the box on every record that needs it; returns the ids ticked now and those already ticked. */
async function tick(ids: string[]) {
  const props = await readContacts(ids, ["qa_flagged", "mailer_hold"]);
  const ticked: string[] = [], already: string[] = [];
  for (const id of ids) {
    const p = props.get(id) || {};
    if (p.qa_flagged === "true" && p.mailer_hold === "true") { already.push(id); continue; }
    await updateContact(id, { qa_flagged: "true", mailer_hold: "true" });
    ticked.push(id);
  }
  return { ticked, already };
}

/** Moves the client's live Follow Up deals to Manual Only (only from the four live stages, never when skip is ticked). */
async function toManualOnly(ids: string[]): Promise<string[]> {
  const moved: string[] = [], seen = new Set<string>();
  for (const c of ids) {
    for (const d of await contactDeals(c, ["pipeline", "dealstage", "skip_fum_automation", "dealname"])) {
      if (seen.has(d.id)) continue; seen.add(d.id);
      if (d.properties.pipeline !== FUM_PIPELINE || !FUM_LIVE.includes(String(d.properties.dealstage)) || d.properties.skip_fum_automation === "true") continue;
      await updateDeal(d.id, { dealstage: MANUAL_ONLY });
      moved.push(d.id);
    }
  }
  return moved;
}

/** Flags a client (their HubSpot deal): the QA box, now. Never throws. */
export async function qaFlag(o: { dealId: string; bookingId?: string | null; client?: string; dog?: string; reason: string; by: string }, sb: SupabaseClient = serviceClient()) {
  const base = { deal_id: o.dealId, booking_id: o.bookingId || null, client: o.client || null, dog: o.dog || null, reason: o.reason, by: o.by };
  try {
    if (!/^\d+$/.test(o.dealId)) return { ok: false, message: "This dog has no HubSpot deal linked, so there's no client record to flag." };
    const ids = await clientContacts(o.dealId);
    if (!ids.length) {
      await sb.from("qa_flags").insert({ ...base, status: "hand", found: "No contacts on the deal" });
      return { ok: false, message: "No contacts on the HubSpot deal: flag the client in HubSpot by hand." };
    }
    const { ticked, already } = await tick(ids);
    const moved = await toManualOnly(ids);
    const status = ticked.length || moved.length ? "ticked" : "already";
    const { error } = await sb.from("qa_flags").insert({ ...base, status, contacts: [...ticked, ...already], moved });
    if (error) return { ok: false, message: /qa_flags|schema cache/i.test(error.message) ? "Ticked in HubSpot, but run migration 061 so the app keeps track." : error.message };
    await auditSystem("QA box: client flagged", `${o.client || "Client"} (${o.dog || "dog"}), ${o.reason}, by ${o.by}: ${ticked.length} contact${ticked.length === 1 ? "" : "s"} ticked${already.length ? `, ${already.length} already` : ""}${moved.length ? `, follow-up moved to Manual Only` : ""}.`, { link: `https://app.hubspot.com/contacts/21869370/record/0-3/${o.dealId}` }).catch(() => null);
    return { ok: true, message: status === "already" ? "Already flagged in HubSpot: nothing to change." : `Flagged: ${ticked.length} contact${ticked.length === 1 ? "" : "s"} ticked${moved.length ? ", follow-up moved to Manual Only" : ""}. No automated emails go to them now.` };
  } catch (e) {
    await sb.from("qa_flags").insert({ ...base, status: "error", error: (e as Error).message.slice(0, 300) }).then(() => null, () => null);
    return { ok: false, message: `HubSpot didn't take it: ${(e as Error).message}. It's recorded; try again in a minute.` };
  }
}

/** The 10-minute check: flags 20 minutes and a day old are checked again (mailer_hold, a live Mailer sequence, a deal that
 *  slipped out of Manual Only). Never throws. */
export async function runQaChecks(sb: SupabaseClient = serviceClient(), now = new Date()) {
  const out = { checked: 0, fixed: 0 };
  try {
    const { data, error } = await sb.from("qa_flags").select("id, contacts, checks, at").in("status", ["ticked", "already"]).lt("checks", 2).gte("at", new Date(now.getTime() - 3 * 864e5).toISOString()).limit(20);
    if (error) return out;
    for (const f of (data || []) as { id: string; contacts: string[]; checks: number; at: string }[]) {
      const age = now.getTime() - Date.parse(f.at);
      if ((f.checks === 0 && age < 20 * 60e3) || (f.checks === 1 && age < 864e5) || !f.contacts.length) continue;
      const props = await readContacts(f.contacts, ["mailer_hold", "dw_campaign", "dw_next_send"]);
      for (const [id, p] of props) {
        const fix: Record<string, string> = {};
        if (p.mailer_hold !== "true") fix.mailer_hold = "true";
        const live = p.dw_next_send && String(p.dw_next_send) !== "9999999" && p.dw_campaign !== "post_program_thank_you";
        if (live) Object.assign(fix, { dw_campaign: "-", dw_campaign_step: "0", dw_next_send: "" });
        if (Object.keys(fix).length) { await updateContact(id, fix); out.fixed++; }
      }
      out.fixed += (await toManualOnly(f.contacts)).length;
      await sb.from("qa_flags").update({ checks: f.checks + 1, checked_at: now.toISOString() }).eq("id", f.id);
      out.checked++;
    }
  } catch { /* the next run tries again */ }
  return out;
}

export async function qaFlagOf(dealId: string, sb: SupabaseClient = serviceClient()) {
  const { data, error } = await sb.from("qa_flags").select("status, reason, by, at, contacts, moved").eq("deal_id", dealId).in("status", ["ticked", "already"]).order("at", { ascending: false }).limit(1);
  return error ? null : ((data || [])[0] as { status: string; reason: string; by: string; at: string; contacts: string[]; moved: string[] } | undefined) || null;
}
