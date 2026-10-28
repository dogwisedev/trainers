"use server";
import { revalidatePath } from "next/cache";
import { audited } from "@/lib/audit";
import { getViewer } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { fileMeta, listFolderFiles } from "@/lib/drive";
import { driveIdFrom, kindFor } from "@/lib/training";
import { PLANS, planLabel } from "@/lib/trainingPlan";
import { PROGRAMS } from "@/lib/programs";

type R = { ok: boolean; message: string };
const admin = async () => { const v = await getViewer(); return v?.role === "admin" ? v : null; };
const okPlan = (p: string) => (PLANS as readonly string[]).includes(p);
const done = (message: string): R => { revalidatePath("/a/materials"); return { ok: true, message }; };
const nextPosition = async (plan: string) => {
  const { data } = await serviceClient().from("training_materials").select("position").eq("plan", plan).eq("active", true).order("position", { ascending: false }).limit(1);
  return ((data || [])[0]?.position || 0) + 1;
};

/** Add one item to a list: a Drive link (video or PDF), a title and the message posted with it. */
export async function addMaterialAction(_: R | null, f: FormData): Promise<R> {
  return audited("addMaterialAction", { plan: String(f.get("plan") || ""), link: String(f.get("link") || "") }, async () => {
    if (isDemo()) return { ok: false, message: "Demo mode." };
    const v = await admin(); if (!v) return { ok: false, message: "Admins only." };
    const plan = String(f.get("plan") || ""), id = driveIdFrom(String(f.get("link") || ""));
    if (!okPlan(plan)) return { ok: false, message: "Pick a program first." };
    if (!id) return { ok: false, message: "Paste the Google Drive link to the video or PDF." };
    const meta = await fileMeta(id);
    if (!meta.ok) return { ok: false, message: meta.message || "The app can't open that file." };
    const mime = meta.mimeType || "";
    if (!/^video\//.test(mime) && mime !== "application/pdf" && !/^image\//.test(mime)) return { ok: false, message: "That's not a video, PDF or photo. Link the file itself, not a folder (use Import a folder for that)." };
    const title = (String(f.get("title") || "").trim() || (meta.name || "Training material").replace(/\.[a-z0-9]{2,4}$/i, "")).slice(0, 140);
    const { error } = await serviceClient().from("training_materials").insert({ plan, position: await nextPosition(plan), title, message: String(f.get("message") || "").trim().slice(0, 1000) || null, drive_id: id, kind: kindFor(mime), created_by: v.userId });
    return error ? { ok: false, message: error.message } : done(`Added "${title}" to ${planLabel(plan)}.`);
  });
}

/** Add every video and PDF in a Drive folder to a list, in name order (1, 2 … 10). Files already on the list are left out. */
export async function importFolderAction(_: R | null, f: FormData): Promise<R> {
  return audited("importFolderAction", { plan: String(f.get("plan") || ""), link: String(f.get("folder") || "") }, async () => {
    if (isDemo()) return { ok: false, message: "Demo mode." };
    const v = await admin(); if (!v) return { ok: false, message: "Admins only." };
    const plan = String(f.get("plan") || ""), id = driveIdFrom(String(f.get("folder") || ""));
    if (!okPlan(plan)) return { ok: false, message: "Pick a program first." };
    if (!id) return { ok: false, message: "Paste the Google Drive folder's link." };
    let files;
    try { files = await listFolderFiles(id); } catch (e) { return { ok: false, message: `Couldn't open that folder: ${(e as Error).message}. Set it to "Anyone with the link can view".` }; }
    const sb = serviceClient();
    const { data: have } = await sb.from("training_materials").select("drive_id").eq("plan", plan).eq("active", true);
    const already = new Set(((have || []) as { drive_id: string }[]).map((x) => x.drive_id));
    const add = files.filter((x) => !already.has(x.id));
    if (!add.length) return { ok: true, message: files.length ? "Everything in that folder is already on this list." : "No videos or PDFs in that folder." };
    let pos = await nextPosition(plan);
    const { error } = await sb.from("training_materials").insert(add.map((x) => ({ plan, position: pos++, title: x.name.replace(/\.[a-z0-9]{2,4}$/i, "").slice(0, 140), message: null, drive_id: x.id, kind: kindFor(x.mimeType), created_by: v.userId })));
    return error ? { ok: false, message: error.message } : done(`Added ${add.length} item${add.length > 1 ? "s" : ""} to ${planLabel(plan)}. Now write a short message for each.`);
  });
}

export async function saveMaterialAction(_: R | null, f: FormData): Promise<R> {
  return audited("saveMaterialAction", { id: String(f.get("id") || ""), title: String(f.get("title") || "") }, async () => {
    if (isDemo() || !(await admin())) return { ok: false, message: "Admins only." };
    const title = String(f.get("title") || "").trim().slice(0, 140);
    if (!title) return { ok: false, message: "Give it a title." };
    const { error } = await serviceClient().from("training_materials").update({ title, message: String(f.get("message") || "").trim().slice(0, 1000) || null, updated_at: new Date().toISOString() }).eq("id", String(f.get("id") || ""));
    return error ? { ok: false, message: error.message } : done("Saved.");
  });
}

/** Move an item up or down its list. */
export async function moveMaterialAction(id: string, dir: "up" | "down"): Promise<R> {
  return audited("moveMaterialAction", { id, dir }, async () => {
    if (isDemo() || !(await admin())) return { ok: false, message: "Admins only." };
    const sb = serviceClient();
    const { data: it } = await sb.from("training_materials").select("id, plan, position").eq("id", id).maybeSingle();
    if (!it) return { ok: false, message: "Not found." };
    const q = sb.from("training_materials").select("id, position").eq("plan", it.plan).eq("active", true);
    const { data: nb } = await (dir === "up" ? q.lt("position", it.position).order("position", { ascending: false }) : q.gt("position", it.position).order("position")).limit(1);
    const other = (nb || [])[0] as { id: string; position: number } | undefined;
    if (!other) return { ok: true, message: "" };
    await sb.from("training_materials").update({ position: other.position }).eq("id", it.id);
    await sb.from("training_materials").update({ position: it.position }).eq("id", other.id);
    return done("");
  });
}

/** Take an item off its list (dogs that already got it keep it in their chat). */
export async function removeMaterialAction(id: string): Promise<R> {
  return audited("removeMaterialAction", { id }, async () => {
    if (isDemo() || !(await admin())) return { ok: false, message: "Admins only." };
    const { error } = await serviceClient().from("training_materials").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
    return error ? { ok: false, message: error.message } : done("Removed.");
  });
}

export async function savePlanAction(_: R | null, f: FormData): Promise<R> {
  return audited("savePlanAction", { plan: String(f.get("plan") || ""), first_day: String(f.get("first_day") || ""), start_after: String(f.get("start_after") || ""), every_days: String(f.get("every_days") || "") }, async () => {
    if (isDemo() || !(await admin())) return { ok: false, message: "Admins only." };
    const plan = String(f.get("plan") || "");
    if (!okPlan(plan)) return { ok: false, message: "Pick a program first." };
    const n = (k: string, d: number, min: number) => Math.max(min, Math.min(60, Math.round(Number(f.get(k)) || d)));
    const { error } = await serviceClient().from("training_plans").upsert({ plan, first_day: n("first_day", 2, 1), start_after: n("start_after", 2, 0), every_days: n("every_days", 4, 1), updated_at: new Date().toISOString() });
    return error ? { ok: false, message: error.message } : done("Saved.");
  });
}

export async function saveIntroAction(_: R | null, f: FormData): Promise<R> {
  return audited("saveIntroAction", {}, async () => {
    if (isDemo() || !(await admin())) return { ok: false, message: "Admins only." };
    const intro = String(f.get("intro") || "").trim().slice(0, 600);
    if (!intro) return { ok: false, message: "Write the intro." };
    const { error } = await serviceClient().from("app_state").upsert({ key: "training_intro", value: intro, updated_at: new Date().toISOString() });
    return error ? { ok: false, message: error.message } : done("Saved.");
  });
}

/** Dog page: the program used for materials (and the report/certificate), when the booking's own name isn't clear. */
export async function setProgramChoiceAction(bookingId: string, program: string): Promise<R> {
  return audited("setProgramChoiceAction", { bookingId, program }, async () => {
    if (isDemo() || !(await admin())) return { ok: false, message: "Admins only." };
    if (program && !(PROGRAMS as readonly string[]).includes(program)) return { ok: false, message: "Pick one of the programs." };
    const { error } = await serviceClient().from("bookings").update({ program_choice: program || null }).eq("id", bookingId);
    revalidatePath(`/a/dogs/${bookingId}`); revalidatePath("/a");
    return error ? { ok: false, message: error.message } : { ok: true, message: program ? `Program set: ${program}.` : "Back to the booking's own program." };
  });
}

export async function setTrainingPausedAction(bookingId: string, paused: boolean): Promise<R> {
  return audited("setTrainingPausedAction", { bookingId, paused: paused ? "yes" : "no" }, async () => {
    if (isDemo() || !(await admin())) return { ok: false, message: "Admins only." };
    const { error } = await serviceClient().from("bookings").update({ training_paused: paused }).eq("id", bookingId);
    revalidatePath(`/a/dogs/${bookingId}`);
    return error ? { ok: false, message: error.message } : { ok: true, message: paused ? "Paused: nothing more goes out for this dog until you resume." : "Resumed." };
  });
}
