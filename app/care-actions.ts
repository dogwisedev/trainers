"use server";
import { revalidatePath } from "next/cache";
import { audited } from "@/lib/audit";
import { getViewer } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { qaFlag } from "@/lib/qaBox";
import { openTicketsFor, saveCaseUpdate, type CaseAction } from "@/lib/caseUpdates";

// Watch list and client notes (migration 060).
type R = { ok: boolean; message: string };
const name = (v: { name: string; email?: string }) => (v.name === "Dogwise team" || v.name === "Dogwise Admin" ? (v.email || v.name).split("@")[0] : v.name);
const migrate = (m: string) => (/watch_list|client_notes|schema cache/i.test(m) ? "Run migration 060 in Supabase first." : m);

export async function watchAction(bookingId: string, on: boolean, reason = "", note = ""): Promise<R> {
  return audited(on ? "watchDog" : "unwatchDog", { bookingId, reason, note }, async () => {
    if (isDemo()) return { ok: false, message: "Demo mode." };
    const v = await getViewer();
    if (!v || v.role !== "admin") return { ok: false, message: "Admins only." };
    const sb = serviceClient();
    const { error } = on
      ? await sb.from("watch_list").upsert({ booking_id: bookingId, reason: reason || "Other", note: note.trim().slice(0, 300) || null, by: name(v), at: new Date().toISOString() }, { onConflict: "booking_id" })
      : await sb.from("watch_list").delete().eq("booking_id", bookingId);
    revalidatePath(`/a/dogs/${bookingId}`);
    return error ? { ok: false, message: migrate(error.message) } : { ok: true, message: on ? "Watching: it's in the office brief until you stop." : "Stopped watching." };
  });
}

/** A standing note about the client (admins and the dog's trainer). Office-only notes are admins only. */
export async function addClientNoteAction(dealKey: string, text: string, officeOnly: boolean, path: string): Promise<R> {
  return audited("addClientNote", { dealKey, officeOnly }, async () => {
    if (isDemo()) return { ok: false, message: "Demo mode." };
    const v = await getViewer();
    if (!v || (v.role !== "admin" && v.role !== "trainer")) return { ok: false, message: "Sign in again." };
    const t = text.replace(/\s+/g, " ").trim().slice(0, 400);
    if (t.length < 3) return { ok: false, message: "Write the note first." };
    const sb = serviceClient();
    if (v.role === "trainer") {
      const { data: b } = await sb.from("bookings").select("id").or(`hubspot_deal_id.eq.${dealKey},id.eq.${/^[0-9a-f-]{36}$/i.test(dealKey) ? dealKey : "00000000-0000-0000-0000-000000000000"}`).eq("trainer_id", v.trainerId || "").limit(1);
      if (!b?.length) return { ok: false, message: "Not one of your dogs." };
    }
    const { error } = await sb.from("client_notes").insert({ deal_key: dealKey, text: t, office_only: v.role === "admin" && officeOnly, by: name(v), role: v.role });
    revalidatePath(path);
    return error ? { ok: false, message: migrate(error.message) } : { ok: true, message: "Saved." };
  });
}

export async function deleteClientNoteAction(id: string, path: string): Promise<R> {
  return audited("deleteClientNote", { id }, async () => {
    if (isDemo()) return { ok: false, message: "Demo mode." };
    const v = await getViewer();
    if (!v || v.role !== "admin") return { ok: false, message: "Admins only." };
    const { error } = await serviceClient().from("client_notes").delete().eq("id", id);
    revalidatePath(path);
    return error ? { ok: false, message: error.message } : { ok: true, message: "Removed." };
  });
}

/** QA box: no automated emails to this client (HubSpot qa_flagged + mailer_hold, Follow Up to Manual Only). Admins. */
export async function qaFlagAction(bookingId: string, reason: string): Promise<R> {
  return audited("qaFlag", { bookingId, reason }, async () => {
    if (isDemo()) return { ok: false, message: "Demo mode." };
    const v = await getViewer();
    if (!v || v.role !== "admin") return { ok: false, message: "Admins only." };
    const { data: b } = await serviceClient().from("bookings").select("id, hubspot_deal_id, client_name, dog_name").eq("id", bookingId).maybeSingle();
    if (!b) return { ok: false, message: "Dog not found." };
    const r = await qaFlag({ dealId: b.hubspot_deal_id || "", bookingId, client: b.client_name, dog: b.dog_name || undefined, reason, by: name(v) });
    revalidatePath(`/a/dogs/${bookingId}`);
    return r;
  });
}

/** Case update on the dog page: a note on the HubSpot deal now, and the actions picked (admins). */
export async function caseUpdateAction(bookingId: string, text: string, forSean: boolean, actions: CaseAction[]): Promise<R> {
  return audited("caseUpdate", { bookingId, forSean, actions }, async () => {
    if (isDemo()) return { ok: false, message: "Demo mode." };
    const v = await getViewer();
    if (!v || v.role !== "admin") return { ok: false, message: "Admins only." };
    const { data: b } = await serviceClient().from("bookings").select("id, hubspot_deal_id, client_name, dog_name").eq("id", bookingId).maybeSingle();
    if (!b) return { ok: false, message: "Dog not found." };
    const r = await saveCaseUpdate({ dealId: b.hubspot_deal_id || "", bookingId, client: b.client_name, dog: b.dog_name || "", text, by: name(v), forSean, actions: actions.slice(0, 3) });
    revalidatePath(`/a/dogs/${bookingId}`);
    return r;
  });
}
export async function ticketsForAction(bookingId: string): Promise<{ id: string; subject: string }[]> {
  try {
    const v = await getViewer();
    if (!v || v.role !== "admin" || isDemo()) return [];
    const { data: b } = await serviceClient().from("bookings").select("client_name, dog_name").eq("id", bookingId).maybeSingle();
    return b ? await openTicketsFor(b.client_name, b.dog_name || "") : [];
  } catch { return []; }
}
export async function settleForSeanAction(id: string): Promise<R> {
  const v = await getViewer();
  if (!v || v.role !== "admin") return { ok: false, message: "Admins only." };
  const { error } = await serviceClient().from("case_updates").update({ settled_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, message: error.message } : { ok: true, message: "Settled." };
}
