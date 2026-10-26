"use server";
import { audited } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { serviceClient } from "@/lib/supabase";
import { profileAccess } from "@/lib/pretrainingAccess";
import { addVaccineFile, reviewVaccines, saveAnswers, setCleared, setSlot } from "@/lib/pretraining";
import { findFile } from "@/lib/drive";

export type ProfileResult = { ok: boolean; message: string };
const NO: ProfileResult = { ok: false, message: "You can't change this." };

/** The chat's deal, the booking on it, and who's asking (admin or the client). */
async function guard(chatId: string, bookingId: string, adminOnly = false) {
  const a = await profileAccess(chatId);
  if (!a || !a.edit || !a.dealId || (adminOnly && a.v.role !== "admin")) return null;
  const { data: b } = await serviceClient().from("bookings").select("id, hubspot_deal_id").eq("id", bookingId).maybeSingle();
  if (!b || b.hubspot_deal_id !== a.dealId) return null;
  return { ...a, dealId: a.dealId, who: { name: a.v.name, role: a.v.role as "admin" | "client" } };
}

export async function saveProfileAction(chatId: string, bookingId: string, values: Record<string, string>): Promise<ProfileResult> {
  return audited("saveProfileAction", { chatId, bookingId, values }, async () => {
  try {
    const g = await guard(chatId, bookingId);
    if (!g) return NO;
    const r = await saveAnswers(g.dealId, bookingId, values, g.who);
    revalidatePath("/", "layout");
    return r;
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}

export async function reviewVaccinesAction(chatId: string, bookingId: string, ok: boolean, missing: string[]): Promise<ProfileResult> {
  return audited("reviewVaccinesAction", { chatId, bookingId, ok, missing }, async () => {
  try {
    const g = await guard(chatId, bookingId, true);
    if (!g) return NO;
    const r = await reviewVaccines(g.dealId, bookingId, ok, missing, g.who);
    revalidatePath("/", "layout");
    return r;
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}

export async function setClearedAction(chatId: string, bookingId: string, cleared: boolean): Promise<ProfileResult> {
  return audited("setClearedAction", { chatId, bookingId, cleared }, async () => {
  try {
    const g = await guard(chatId, bookingId, true);
    if (!g) return NO;
    const r = await setCleared(g.dealId, bookingId, cleared, g.who);
    revalidatePath("/", "layout");
    return r;
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}

export async function setSlotAction(chatId: string, bookingId: string, slot: number): Promise<ProfileResult> {
  return audited("setSlotAction", { chatId, bookingId, slot }, async () => {
  try {
    const g = await guard(chatId, bookingId, true);
    if (!g || !(slot >= 1 && slot <= 4)) return NO;
    const r = await setSlot(g.dealId, bookingId, slot, g.who);
    revalidatePath("/", "layout");
    return r;
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}

/** After a vaccine file reached Drive (see /api/pretraining/upload): find it and add it to the dog. */
export async function addVaccineFileAction(chatId: string, bookingId: string, storedName: string, name: string): Promise<ProfileResult> {
  return audited("addVaccineFileAction", { chatId, bookingId, storedName, name }, async () => {
  try {
    const g = await guard(chatId, bookingId);
    if (!g) return NO;
    const { data: c } = await serviceClient().from("chats").select("drive_folder_id").eq("id", chatId).maybeSingle();
    if (!c?.drive_folder_id) return { ok: false, message: "The upload folder is missing. Try again." };
    const id = await findFile(c.drive_folder_id, storedName);
    if (!id) return { ok: false, message: "The upload isn't in Drive yet. Try again in a moment." };
    const r = await addVaccineFile(bookingId, { id, name: name.slice(0, 120) }, g.who);
    revalidatePath("/", "layout");
    return r;
  } catch (e) { return { ok: false, message: (e as Error).message }; }
});
}
