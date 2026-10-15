import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDemo, serviceClient } from "./supabase";
import { addDays, short } from "./dates";
import { etParts } from "./chatRules";
import { raiseIncident, resolveIncidents } from "./incidents";
import { alertAdmins } from "./adminAlert";
import { DealProps, PropDef, dealContacts, hubspotConfigured, optionValue, propDefs, readContacts, readDeals, updateContact, updateDeal } from "./hubspot";
import {
  Answers, CLIENT_KEYS, CONTACT_PROPS, DEAL_PROPS, DOG_KEYS, DOG_NAME_PROPS, QUESTIONS, Ready, VACCINE_FILE_PROP, VACCINES, VaccineFile, VaccineState,
  balanceOwed, blank, checklist, clearReady, isYes, matchSlots, vaccineStatus
} from "./pretrainingFields";

// Before-training checklist. HubSpot is the source of truth:
//  - the client's answers are CONTACT properties (dog 1 = k9___dog_name); dogs 2 to 4 are kept here, per dog
//  - names, how many dogs, balance link and the checklist are DEAL properties
// The cron (/api/hubspot/sync) reads them every 30 minutes, retries answers HubSpot hasn't accepted yet,
// ticks "forms" when every answer is in, and opens a "Not ready" incident 7 days before a dog's start.

const READY_DAYS = 7;
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

type BookingRow = { id: string; dog_name: string | null; client_name: string; start_date: string; end_date: string; status: string; trainer_id: string; created_at: string; hubspot_deal_id: string | null; trainers?: { name: string } | null };
type DealRow = { deal_id: string; contact_id: string | null; deal: DealProps; contact: DealProps; pending: Record<string, string>; synced_at: string | null; sync_error: string | null };
type DogRow = { booking_id: string; deal_id: string; slot: number; slot_set_by: string | null; cleared_by?: string | null; cleared_at?: string | null; answers: Answers; vaccines: VaccineState; changes: Record<string, { by: string; role: string; at: string }> };

export type DogView = {
  booking: BookingRow; slot: number; slotSetBy: string | null; name: string; answers: Answers; vaccines: VaccineState; files: VaccineFile[];
  vaccine: ReturnType<typeof vaccineStatus>; changes: DogRow["changes"]; ready: Ready; changedSinceStart: boolean; cleared: { by: string; at: string } | null;
};
export type Profile = {
  dealId: string; contactId: string | null; client: Answers; deal: DealProps; dogs: DogView[]; howMany: number | null;
  balanceLink: string; syncedAt: string | null; syncError: string | null; pendingCount: number;
  defs: Record<string, { type: string; fieldType: string; options: { label: string; value: string }[] }>;
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const pick = (o: DealProps, keys: string[]): Answers => Object.fromEntries(keys.map((k) => [k, str(o[k])]));
const today = () => etParts(new Date()).date;

/** HubSpot files from the form's upload field (one or several links). */
function hubspotFiles(contact: DealProps): VaccineFile[] {
  return str(contact[VACCINE_FILE_PROP]).split(/[;\s]+/).filter((u) => /^https?:\/\//.test(u))
    .map((u, i) => ({ id: u, name: `Vaccine record from the HubSpot form${i ? ` (${i + 1})` : ""}`, at: "", by: "client", source: "hubspot" as const }));
}

// ── Reading ──────────────────────────────────────────────────────────────────

async function bookingsFor(sb: SupabaseClient, dealIds: string[]) {
  if (!dealIds.length) return [] as BookingRow[];
  const { data } = await sb.from("bookings").select("id, dog_name, client_name, start_date, end_date, status, trainer_id, created_at, hubspot_deal_id, trainers(name)").in("hubspot_deal_id", dealIds).neq("status", "cancelled");
  return (data || []) as unknown as BookingRow[];
}

/** "Missing vaccines" on the deal (option values like "Dhlpp;Rabies") as our labels. */
const dealMissing = (deal: DealProps) => str(deal.missing_vaccines).split(";").map((x) => x.trim()).filter(Boolean)
  .map((x) => VACCINES.find((v) => v.toLowerCase() === x.toLowerCase()) || x);

function buildProfile(dealId: string, row: DealRow | null, dogRows: DogRow[], bookings: BookingRow[], defs: Profile["defs"]): Profile {
  const contact = { ...(row?.contact || {}), ...(row?.pending || {}) } as DealProps;
  const deal = row?.deal || {};
  const client = pick(contact, CLIENT_KEYS);
  const names = DOG_NAME_PROPS.map((p) => str(deal[p]));
  const howMany = parseInt(str(deal.how_many_dogs_need_training_), 10) || null;
  const mismatch = howMany && howMany !== bookings.length ? `HubSpot says ${howMany} dog${howMany > 1 ? "s" : ""}, ${bookings.length} booked in the app` : null;
  const dealYes = isYes(deal.vaccines_in_order_);
  const balanceLink = balanceOwed(deal);
  const dogs = bookings.map((b): DogView => {
    const d = dogRows.find((x) => x.booking_id === b.id);
    const slot = d?.slot || 1;
    const answers = slot === 1 ? pick(contact, DOG_KEYS) : { ...Object.fromEntries(DOG_KEYS.map((k) => [k, ""])), ...(d?.answers || {}) };
    const vaccines = d?.vaccines || {};
    const files = [...(slot === 1 ? hubspotFiles(contact) : []), ...(vaccines.files || [])];
    const vaccine = vaccineStatus(vaccines, dealYes, files.length > 0, dealMissing(deal));
    const changes = d?.changes || {};
    return {
      booking: b, slot, slotSetBy: d?.slot_set_by || null, name: names[slot - 1] || b.dog_name || `Dog ${slot}`, answers, vaccines, files, vaccine, changes,
      ready: d?.cleared_by ? clearReady(checklist({ client, dog: answers, vaccines: vaccine, balanceLink, dogsMismatch: mismatch })) : checklist({ client, dog: answers, vaccines: vaccine, balanceLink, dogsMismatch: mismatch }),
      cleared: d?.cleared_by ? { by: d.cleared_by, at: d.cleared_at || "" } : null,
      changedSinceStart: Object.values(changes).some((c) => c.role === "client" && c.at.slice(0, 10) >= b.start_date)
    };
  }).sort((a, b) => a.slot - b.slot);
  return {
    dealId, contactId: row?.contact_id || null, client, deal, dogs, howMany, balanceLink, defs,
    syncedAt: row?.synced_at || null, syncError: row?.sync_error || null, pendingCount: Object.keys(row?.pending || {}).length
  };
}

async function fieldDefs(): Promise<Profile["defs"]> {
  try {
    const defs = await propDefs("contacts");
    return Object.fromEntries(QUESTIONS.map((q) => [q.key, defs.get(q.key)]).filter(([, d]) => d).map(([k, d]) => {
      const x = d as PropDef;
      return [k as string, { type: x.type, fieldType: x.fieldType, options: x.options.map((o) => ({ label: o.label, value: o.value })) }];
    }));
  } catch { return {}; }
}

/** Everything about a deal's dogs, for the Dog profile. Refreshes from HubSpot if the copy is older than `freshMinutes`. */
export async function loadProfile(dealId: string, freshMinutes = 10): Promise<Profile | null> {
  if (isDemo() || !/^\d+$/.test(dealId)) return null;
  const sb = serviceClient();
  let { data: row } = await sb.from("pretraining_deals").select("*").eq("deal_id", dealId).maybeSingle();
  if (hubspotConfigured() && (!row?.synced_at || Date.now() - new Date(row.synced_at).getTime() > freshMinutes * 60e3)) {
    await syncPretraining({ dealIds: [dealId], sb, quietIncidents: true }).catch(() => null);
    row = (await sb.from("pretraining_deals").select("*").eq("deal_id", dealId).maybeSingle()).data;
  }
  const bookings = await bookingsFor(sb, [dealId]);
  if (!bookings.length) return null;
  const [{ data: dogs }, defs] = await Promise.all([sb.from("pretraining_dogs").select("*").eq("deal_id", dealId), fieldDefs()]);
  return buildProfile(dealId, row as DealRow | null, (dogs || []) as DogRow[], bookings, defs);
}

/** Ready / missing per booking, from the copy in the database (no HubSpot calls): for badges and the admin list. */
export async function readinessFor(bookingIds: string[]): Promise<Map<string, { ready: Ready; dog: DogView }>> {
  const out = new Map<string, { ready: Ready; dog: DogView }>();
  if (isDemo() || !bookingIds.length) return out;
  const sb = serviceClient();
  const { data: bks } = await sb.from("bookings").select("hubspot_deal_id").in("id", bookingIds.slice(0, 300));
  const dealIds = [...new Set(((bks || []) as { hubspot_deal_id: string | null }[]).map((b) => b.hubspot_deal_id).filter((x): x is string => !!x && /^\d+$/.test(x)))];
  if (!dealIds.length) return out;
  const [{ data: rows }, { data: dogs }, bookings] = await Promise.all([
    sb.from("pretraining_deals").select("*").in("deal_id", dealIds),
    sb.from("pretraining_dogs").select("*").in("deal_id", dealIds),
    bookingsFor(sb, dealIds)
  ]);
  for (const id of dealIds) {
    const row = ((rows || []) as DealRow[]).find((r) => r.deal_id === id);
    if (!row?.synced_at) continue; // never read from HubSpot yet: say nothing rather than "everything missing"
    const p = buildProfile(id, row, ((dogs || []) as DogRow[]).filter((d) => d.deal_id === id), bookings.filter((b) => b.hubspot_deal_id === id), {});
    for (const d of p.dogs) if (bookingIds.includes(d.booking.id)) out.set(d.booking.id, { ready: d.ready, dog: d });
  }
  return out;
}

/**
 * Sends answers to the HubSpot contact. If HubSpot refuses some values (an option it doesn't allow), those are named and
 * left out so the rest still go through. Anything not sent (no permission, HubSpot down) stays waiting for the next try.
 */
async function pushContact(contactId: string, props: Record<string, string>): Promise<{ pending: Record<string, string>; error: string | null; sent: number }> {
  const left = { ...props }, refused: string[] = [];
  const named = () => refused.map((k) => QUESTIONS.find((q) => q.key === k)?.label || k).join("; ");
  for (let i = 0; i < 4 && Object.keys(left).length; i++) {
    try {
      await updateContact(contactId, left);
      return { pending: {}, sent: Object.keys(left).length, error: refused.length ? `HubSpot refused the answer to: ${named()}. Change it to one of the options HubSpot allows.` : null };
    } catch (e) {
      const m = (e as Error).message;
      const bad = [...m.matchAll(/\\?"(?:name|propertyName)\\?"\s*:\s*\\?"([a-z0-9_]+)/g)].map((x) => x[1]).filter((k) => k in left);
      if (/HubSpot 400/.test(m) && bad.length) { for (const k of bad) { refused.push(k); delete left[k]; } continue; }
      const why = /HubSpot 403/.test(m) && /scope/i.test(m)
        ? "HubSpot token can't write to contacts yet: add the crm.objects.contacts.write scope to the private app."
        : `HubSpot didn't accept the answers: ${m}`.slice(0, 400);
      return { pending: left, sent: 0, error: `${why}${refused.length ? ` Also refused: ${named()}.` : ""}` };
    }
  }
  return { pending: left, sent: 0, error: refused.length ? `HubSpot refused: ${named()}.` : null };
}

// ── Sync (cron) ──────────────────────────────────────────────────────────────

export type PretrainingResult = { deals: number; dogs: number; pushed: number; incidents: string[]; errors: string[] };

export async function syncPretraining(opts: { dealIds?: string[]; sb?: SupabaseClient; quietIncidents?: boolean } = {}): Promise<PretrainingResult> {
  const out: PretrainingResult = { deals: 0, dogs: 0, pushed: 0, incidents: [], errors: [] };
  if (isDemo() || !hubspotConfigured()) return out;
  const sb = opts.sb || serviceClient();
  const t = today();
  let q = sb.from("bookings").select("hubspot_deal_id").not("hubspot_deal_id", "is", null).neq("status", "cancelled").gte("end_date", t);
  if (opts.dealIds?.length) q = q.in("hubspot_deal_id", opts.dealIds);
  const { data: live } = await q;
  const dealIds = [...new Set(((live || []) as { hubspot_deal_id: string }[]).map((b) => b.hubspot_deal_id).filter((id) => /^\d+$/.test(id)))];
  if (!dealIds.length) return out;
  out.deals = dealIds.length;

  let deals: Map<string, DealProps>, contactOf: Map<string, string[]>, contacts: Map<string, DealProps>, dealDefs: Map<string, PropDef>;
  try {
    [deals, contactOf, dealDefs] = await Promise.all([readDeals(dealIds, DEAL_PROPS), dealContacts(dealIds), propDefs("deals")]);
    contacts = await readContacts([...contactOf.values()].flat(), CONTACT_PROPS);
  } catch (e) { out.errors.push((e as Error).message); return out; }

  const [{ data: rows }, { data: dogRows }, { data: chats }, bookings] = await Promise.all([
    sb.from("pretraining_deals").select("*").in("deal_id", dealIds),
    sb.from("pretraining_dogs").select("*").in("deal_id", dealIds),
    sb.from("chats").select("id, deal_key, client_user_id").in("deal_key", dealIds).eq("status", "open"),
    bookingsFor(sb, dealIds)
  ]);
  const now = new Date().toISOString();

  for (const dealId of dealIds) {
    try {
      const deal = deals.get(dealId);
      if (!deal) continue; // missing deals are reported by the date sync
      const old = ((rows || []) as DealRow[]).find((r) => r.deal_id === dealId);
      // A client can be two contacts (a form link without their email makes a new one). Read them all: the main one
      // (has an email, then most answers) is where the app writes; the others fill its blanks. Merging them in HubSpot is the real fix.
      const ids = contactOf.get(dealId) || [];
      const answered = (c: DealProps) => CONTACT_PROPS.filter((k) => !blank(c[k])).length;
      const ranked = ids.map((id) => ({ id, c: contacts.get(id) || {} })).sort((a, b) => Number(!blank(b.c.email)) - Number(!blank(a.c.email)) || answered(b.c) - answered(a.c));
      const contactId = ranked[0]?.id || null;
      let contact: DealProps = { ...(ranked[0]?.c || {}) };
      for (const o of ranked.slice(1)) for (const k of CONTACT_PROPS) if (blank(contact[k]) && !blank(o.c[k])) contact[k] = o.c[k];
      deal.__contacts = ids.join(";");
      let pending = { ...(old?.pending || {}) }, syncError: string | null = contactId ? null : "No contact on the HubSpot deal";
      // 1. Answers saved in the app that HubSpot didn't take yet
      if (contactId && Object.keys(pending).length) {
        const r = await pushContact(contactId, pending);
        contact = { ...contact, ...pending }; out.pushed += r.sent; pending = r.pending; syncError = r.error;
      }
      await sb.from("pretraining_deals").upsert({ deal_id: dealId, contact_id: contactId, deal, contact, pending, synced_at: now, sync_error: syncError, updated_at: now });
      // 2. One row per dog, with its slot on the deal (dog 1 = k9___dog_name, dog 2 = dog_2_name…)
      const bks = bookings.filter((b) => b.hubspot_deal_id === dealId);
      const mine = ((dogRows || []) as DogRow[]).filter((d) => d.deal_id === dealId);
      const slots = matchSlots(bks.map((b) => { const d = mine.find((x) => x.booking_id === b.id); return { ...b, slot: d?.slot, slot_set_by: d?.slot_set_by }; }), DOG_NAME_PROPS.map((p) => str(deal[p])));
      for (const b of bks) {
        const d = mine.find((x) => x.booking_id === b.id);
        if (!d) await sb.from("pretraining_dogs").insert({ booking_id: b.id, deal_id: dealId, slot: slots.get(b.id) || 1 });
        else if (!d.slot_set_by && d.slot !== slots.get(b.id)) await sb.from("pretraining_dogs").update({ slot: slots.get(b.id), updated_at: now }).eq("booking_id", b.id);
        out.dogs++;
      }
      // 3. Readiness: tick "forms" in HubSpot, list what's missing, incidents a week out
      const { data: fresh } = await sb.from("pretraining_dogs").select("*").eq("deal_id", dealId);
      const p = buildProfile(dealId, { deal_id: dealId, contact_id: contactId, deal, contact, pending, synced_at: now, sync_error: syncError }, (fresh || []) as DogRow[], bks, {});
      await writeDealChecklist(dealId, deal, dealDefs, p).catch((e) => out.errors.push(`deal ${dealId}: ${(e as Error).message}`));
      const chatId = ((chats || []) as { id: string; deal_key: string }[]).find((c) => c.deal_key === dealId)?.id || null;
      for (const dog of p.dogs) {
        // Vaccine records waiting for a check: tell admins straight away, whenever the start is
        const vref = `vax:${dog.booking.id}`;
        if (!dog.vaccine.toCheck) await resolveIncidents({ kinds: ["check_vaccines"], ref: vref }, "automatic", "Vaccines checked", sb);
        else if (!opts.quietIncidents && await raiseVaccineCheck(dog, chatId, sb)) out.incidents.push(`Check vaccines: ${dog.name}`);
        const ref = `ready:${dog.booking.id}`, b = dog.booking;
        const due = addDays(b.start_date, -READY_DAYS) <= t && t <= b.end_date;
        if (dog.ready.ready || t > b.end_date) { await resolveIncidents({ kinds: ["not_ready"], ref }, "automatic", "Everything is in", sb); continue; }
        if (!due || opts.quietIncidents) continue;
        const list = dog.ready.missing.map((i) => (i.detail ? `${i.label} (${i.detail})` : i.label)).join("; ");
        const soon = b.start_date <= addDays(t, 2);
        if (await raiseIncident({
          kind: "not_ready", urgent: soon, title: `${dog.name} (${b.client_name}), ${b.trainers?.name || "trainer"}`, ref, bookingId: b.id, chatId,
          detail: `${dog.name} starts ${short(b.start_date)} and isn't ready: ${list}.`, link: `${site()}/a/dogs/${b.id}?tab=before`
        }, sb)) out.incidents.push(`Not ready: ${dog.name}`);
        else {
          // Already open: keep its list current
          await sb.from("chat_incidents").update({ detail: `${dog.name} starts ${short(b.start_date)} and isn't ready: ${list}.` }).eq("ref", ref).eq("kind", "not_ready").neq("status", "resolved");
          // Two days out and still not ready: email admins once
          if (soon) {
            const { data: open } = await sb.from("chat_incidents").select("id").eq("ref", ref).eq("kind", "not_ready").neq("status", "resolved").is("last_alert_at", null).maybeSingle();
            if (open) {
              await alertAdmins(`Not ready: ${dog.name} starts ${short(b.start_date)}`, `${dog.name} (${b.client_name}, with ${b.trainers?.name || "the trainer"}) starts ${short(b.start_date)} and still isn't ready: ${list}.`,
                [{ text: `${dog.name}: see what's missing`, link: `${site()}/a/dogs/${b.id}?tab=before` }], { label: "Open To do", link: `${site()}/a` }).catch(() => {});
              await sb.from("chat_incidents").update({ last_alert_at: new Date().toISOString() }).eq("id", open.id);
            }
          }
        }
      }
    } catch (e) { out.errors.push(`deal ${dealId}: ${(e as Error).message}`); }
  }
  return out;
}

/** "Check vaccines" incident: records are in (uploaded in the app or on the HubSpot form) and nobody has checked them. */
async function raiseVaccineCheck(dog: { booking: BookingRow; name: string }, chatId: string | null, sb: SupabaseClient) {
  const b = dog.booking;
  return raiseIncident({
    kind: "check_vaccines", title: `${dog.name} (${b.client_name}), ${b.trainers?.name || "trainer"}`, ref: `vax:${b.id}`, bookingId: b.id, chatId,
    detail: `${dog.name}'s vaccine records are in and need checking (starts ${short(b.start_date)}). Mark them All OK, or which are missing.`,
    link: `${site()}/a/dogs/${b.id}?tab=before#vaccines`
  }, sb);
}

/**
 * HubSpot deal checklist: "forms" ticked as each form is completed in the app (ticks are only added, never removed).
 * A tick-box list: each option whose label says "intake" is ticked when the intake answers are in; "manager" when the
 * Client manager answers are in (an option with a number, e.g. "Client manager 2", is that dog; without one, every dog).
 * A single Yes / tick: set once both forms are complete for every dog. Also fills pre_training_missing if that property exists.
 */
async function writeDealChecklist(dealId: string, deal: DealProps, defs: Map<string, PropDef>, p: Profile) {
  const props: Record<string, string> = {};
  const formsDef = defs.get("forms");
  if (formsDef && p.dogs.length) {
    const intake = p.dogs.every((d) => d.ready.intakeDone);
    const manager = (label: string) => { const n = label.match(/\b([1-4])\b/); return n ? !!p.dogs.find((d) => d.slot === Number(n[1]))?.ready.managerDone : p.dogs.every((d) => d.ready.managerDone); };
    if (formsDef.fieldType === "checkbox" && formsDef.options.length) {
      const have = new Set(str(deal.forms).split(";").map((x) => x.trim()).filter(Boolean)), before = have.size;
      for (const o of formsDef.options) if ((/intake/i.test(o.label) && intake) || (/manager/i.test(o.label) && manager(o.label))) have.add(o.value);
      if (have.size !== before) props.forms = [...have].join(";");
    } else if (p.dogs.every((d) => d.ready.formsDone) && !isYes(deal.forms)) {
      const yes = formsDef.type === "bool" ? "true" : optionValue(formsDef, "Yes") || optionValue(formsDef, "Done") || optionValue(formsDef, "Complete") || (formsDef.type === "string" ? "Yes" : null);
      if (yes) props.forms = yes;
    }
  }
  if (defs.has("pre_training_missing")) {
    const text = p.dogs.flatMap((d) => d.ready.missing.filter((i) => i.who === "client").map((i) => (p.dogs.length > 1 ? `${i.label} (${d.name})` : i.label))).join("; ");
    if (text !== str(deal.pre_training_missing)) props.pre_training_missing = text;
  }
  if (Object.keys(props).length) await updateDeal(dealId, props);
}

// ── Writing (from the Dog profile) ──────────────────────────────────────────

type Who = { name: string; role: "admin" | "client" };

/** Saves answers. Household answers and dog 1's go to the HubSpot contact; dogs 2 to 4 are kept in the app. */
export async function saveAnswers(dealId: string, bookingId: string, values: Record<string, string>, who: Who): Promise<{ ok: boolean; message: string }> {
  const sb = serviceClient();
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (CLIENT_KEYS.includes(k) || DOG_KEYS.includes(k)) clean[k] = String(v ?? "").trim().slice(0, 5000);
  if (!Object.keys(clean).length) return { ok: true, message: "Nothing to save." };
  const [{ data: row }, { data: dogs }] = await Promise.all([
    sb.from("pretraining_deals").select("*").eq("deal_id", dealId).maybeSingle(),
    sb.from("pretraining_dogs").select("*").eq("deal_id", dealId)
  ]);
  const dog = ((dogs || []) as DogRow[]).find((d) => d.booking_id === bookingId);
  if (!row || !dog) return { ok: false, message: "This dog's details haven't loaded from HubSpot yet. Try again in a minute." };
  const toContact: Record<string, string> = {}, toDog: Record<string, string> = {};
  for (const [k, v] of Object.entries(clean)) (CLIENT_KEYS.includes(k) || dog.slot === 1 ? toContact : toDog)[k] = v;
  const at = new Date().toISOString(), stamp = { by: who.name, role: who.role, at };
  let note = "Saved.";
  if (Object.keys(toContact).length) {
    let pending = { ...(row.pending || {}), ...toContact }, error: string | null = null;
    if (row.contact_id && hubspotConfigured()) {
      const r = await pushContact(row.contact_id, pending);
      pending = r.pending; error = r.error;
      if (Object.keys(pending).length) note = "Saved. It'll reach HubSpot shortly.";
    } else note = "Saved. It'll reach HubSpot shortly.";
    await sb.from("pretraining_deals").update({ contact: { ...(row.contact || {}), ...toContact }, pending, sync_error: error, updated_at: at }).eq("deal_id", dealId);
  }
  // Last change per answer: household answers count for every dog on the deal
  for (const d of (dogs || []) as DogRow[]) {
    const keys = Object.keys(clean).filter((k) => CLIENT_KEYS.includes(k) || d.booking_id === bookingId);
    if (!keys.length) continue;
    const changes = { ...(d.changes || {}), ...Object.fromEntries(keys.map((k) => [k, stamp])) };
    await sb.from("pretraining_dogs").update({ changes, ...(d.booking_id === bookingId && Object.keys(toDog).length ? { answers: { ...(d.answers || {}), ...toDog } } : {}), updated_at: at }).eq("booking_id", d.booking_id);
  }
  await syncPretraining({ dealIds: [dealId], sb }).catch(() => null); // re-read HubSpot, tick "forms", clear "not ready"
  return { ok: true, message: note };
}

/** A vaccine file uploaded in the app (it lives in the chat's Drive folder). The team then checks it. */
export async function addVaccineFile(bookingId: string, file: { id: string; name: string }, who: Who) {
  const sb = serviceClient();
  const { data: d } = await sb.from("pretraining_dogs").select("vaccines").eq("booking_id", bookingId).maybeSingle();
  if (!d) return { ok: false, message: "This dog's details haven't loaded yet." };
  const v = (d.vaccines || {}) as VaccineState;
  const files = [...(v.files || []), { id: file.id, name: file.name, at: new Date().toISOString(), by: who.name, source: "app" as const }];
  const status = who.role === "client" && v.status !== "ok" ? "review" : v.status;
  await sb.from("pretraining_dogs").update({ vaccines: { ...v, files, status }, updated_at: new Date().toISOString() }).eq("booking_id", bookingId);
  if (status === "review") {
    const { data: b } = await sb.from("bookings").select("id, dog_name, client_name, start_date, hubspot_deal_id, trainers(name)").eq("id", bookingId).maybeSingle();
    const { data: chat } = b?.hubspot_deal_id ? await sb.from("chats").select("id").eq("deal_key", b.hubspot_deal_id).eq("status", "open").maybeSingle() : { data: null };
    if (b) await raiseVaccineCheck({ booking: b as unknown as BookingRow, name: b.dog_name || "Dog" }, chat?.id || null, sb);
  }
  return { ok: true, message: who.role === "client" ? "Thanks! The team will check it." : "Added." };
}

/** Admin checks the vaccines: all fine, or which are missing. Writes "Vaccines in order?" and "Missing vaccines" on the deal (for all its dogs). */
export async function reviewVaccines(dealId: string, bookingId: string, ok: boolean, missing: string[], who: { name: string }): Promise<{ ok: boolean; message: string }> {
  const sb = serviceClient();
  const { data: dogs } = await sb.from("pretraining_dogs").select("*").eq("deal_id", dealId);
  const list = (dogs || []) as DogRow[];
  const d = list.find((x) => x.booking_id === bookingId);
  if (!d) return { ok: false, message: "Dog not found." };
  const vac: VaccineState = { ...(d.vaccines || {}), status: ok ? "ok" : "missing", missing: ok ? [] : missing.filter((m) => (VACCINES as readonly string[]).includes(m)), reviewedBy: who.name, reviewedAt: new Date().toISOString() };
  await sb.from("pretraining_dogs").update({ vaccines: vac, updated_at: new Date().toISOString() }).eq("booking_id", bookingId);
  await resolveIncidents({ kinds: ["check_vaccines"], ref: `vax:${bookingId}` }, who.name, ok ? "All OK" : `Missing: ${vac.missing?.join(", ")}`, sb);
  // The deal holds one answer for all its dogs: Yes only when every dog is approved
  const { data: row } = await sb.from("pretraining_deals").select("deal").eq("deal_id", dealId).maybeSingle();
  const dealYes = isYes((row?.deal as DealProps | undefined)?.vaccines_in_order_);
  const states = list.map((x) => (x.booking_id === bookingId ? vac : x.vaccines || {}));
  const allOk = states.every((s) => s.status === "ok" || (!s.status && dealYes)); // a dog nobody reviewed in the app keeps the HubSpot tick
  const union = [...new Set(states.flatMap((s) => (s.status === "missing" ? s.missing || [] : [])))];
  try {
    const defs = await propDefs("deals");
    const props: Record<string, string> = {};
    const inOrder = optionValue(defs.get("vaccines_in_order_"), allOk ? "Yes" : "No");
    if (inOrder) props.vaccines_in_order_ = inOrder;
    const missDef = defs.get("missing_vaccines");
    if (missDef) props.missing_vaccines = allOk ? "" : union.map((m) => optionValue(missDef, m) || m).join(";");
    if (Object.keys(props).length) await updateDeal(dealId, props);
    await syncPretraining({ dealIds: [dealId], sb }).catch(() => null);
    return { ok: true, message: allOk ? "Vaccines approved. HubSpot updated." : `Saved: ${union.join(", ") || "records"} missing. HubSpot updated.` };
  } catch (e) { return { ok: true, message: `Saved in the app, but HubSpot didn't take it: ${(e as Error).message}` }; }
}

/** Admin: which dog on the deal this booking is (1 = k9___dog_name, 2 = dog_2_name…). Swaps with the dog already in that slot. */
export async function setSlot(dealId: string, bookingId: string, slot: number, who: { name: string }) {
  const sb = serviceClient();
  const { data: dogs } = await sb.from("pretraining_dogs").select("booking_id, slot").eq("deal_id", dealId);
  const me = (dogs || []).find((d) => d.booking_id === bookingId), other = (dogs || []).find((d) => d.slot === slot && d.booking_id !== bookingId);
  if (!me) return { ok: false, message: "Dog not found." };
  if (other) await sb.from("pretraining_dogs").update({ slot: me.slot, slot_set_by: who.name }).eq("booking_id", other.booking_id);
  await sb.from("pretraining_dogs").update({ slot, slot_set_by: who.name }).eq("booking_id", bookingId);
  return { ok: true, message: "Saved." };
}

/** For the Dog profile button and the client's card: how many things are left on this chat's deal (null = nothing known yet). */
export async function chatReadiness(dealKey: string, forClient: boolean): Promise<{ left: number; balanceLink: string } | null> {
  if (isDemo() || !/^\d+$/.test(dealKey)) return null;
  const sb = serviceClient();
  const { data: bks } = await sb.from("bookings").select("id").eq("hubspot_deal_id", dealKey).neq("status", "cancelled");
  const r = await readinessFor(((bks || []) as { id: string }[]).map((b) => b.id));
  if (!r.size || [...r.values()].every((x) => x.dog.cleared)) return null; // admin said OK to start: no card, no pop-up
  const left = [...r.values()].reduce((n, x) => n + x.ready.missing.filter((i) => !forClient || i.who === "client").length, 0);
  const { data: row } = await sb.from("pretraining_deals").select("deal").eq("deal_id", dealKey).maybeSingle();
  return { left, balanceLink: balanceOwed((row?.deal as DealProps | undefined) || {}) };
}

/** Admin: "OK to start" (or undo). The client stops being asked, "Not ready" closes. HubSpot isn't changed. */
export async function setCleared(dealId: string, bookingId: string, cleared: boolean, who: { name: string }) {
  const sb = serviceClient();
  const { error } = await sb.from("pretraining_dogs").update(cleared ? { cleared_by: who.name, cleared_at: new Date().toISOString() } : { cleared_by: null, cleared_at: null }).eq("booking_id", bookingId).eq("deal_id", dealId);
  if (error) return { ok: false, message: error.message };
  if (cleared) await resolveIncidents({ kinds: ["not_ready"], ref: `ready:${bookingId}` }, who.name, "Marked OK to start", sb);
  return { ok: true, message: cleared ? "Marked OK to start. The client won't be asked for anything more." : "Back to normal: the client sees what's missing again." };
}
