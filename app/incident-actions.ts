"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { raiseIncident } from "@/lib/incidents";
import { INCIDENT_KINDS } from "@/lib/incidentKinds";

type IncidentResult = { ok: boolean; message: string };
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

/** Trainer (or admin): report an incident from the dog's chat. Admins are emailed straight away and it goes on To do. */
export async function reportIncidentAction(_: IncidentResult | null, f: FormData): Promise<IncidentResult> {
  if (isDemo()) return { ok: false, message: "Demo mode." };
  const v = await getViewer();
  if (!v || (v.role !== "trainer" && v.role !== "admin")) return { ok: false, message: "Sign in again." };
  const get = (k: string) => String(f.get(k) || "").trim();
  const chatId = get("chat_id"), bookingId = get("booking_id"), kind = get("kind"), what = get("what"), action = get("action");
  const occurred = get("occurred_at"), vet = get("vet") === "yes", vetDetails = get("vet_details"), told = get("client_told") === "yes";
  if (!INCIDENT_KINDS.includes(kind)) return { ok: false, message: "Choose what happened." };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(occurred)) return { ok: false, message: "Add when it happened." };
  if (what.length < 10) return { ok: false, message: "Describe what happened." };
  if (action.length < 5) return { ok: false, message: "Say what you did about it." };
  if (!get("vet") || !get("client_told")) return { ok: false, message: "Answer the vet and client questions." };
  if (vet && vetDetails.length < 3) return { ok: false, message: "Add the vet visit details." };
  const sb = serviceClient();
  const { data: chat } = await sb.from("chats").select("id, deal_key, trainer_id, title, client_name").eq("id", chatId).maybeSingle();
  if (!chat || (v.role === "trainer" && chat.trainer_id !== v.trainerId)) return { ok: false, message: "You can't report on this chat." };
  const { data: b } = await sb.from("bookings").select("id, dog_name, client_name, hubspot_deal_id, trainer_id, trainers(name)").eq("id", bookingId).maybeSingle();
  if (!b || (b.hubspot_deal_id || b.id) !== chat.deal_key) return { ok: false, message: "Choose the dog." };
  // The time comes from the trainer's phone in their own time zone: keep it as written, read as Eastern for the email
  const { data: rep, error } = await sb.from("incident_reports").insert({
    chat_id: chat.id, booking_id: b.id, trainer_id: b.trainer_id, reported_by: v.name, kind, occurred_at: `${occurred}:00`, what: what.slice(0, 4000), action: action.slice(0, 4000),
    vet, vet_details: vet ? vetDetails.slice(0, 1000) : null, client_told: told
  }).select("id").single();
  if (error) return { ok: false, message: error.message };
  const trainer = (b.trainers as unknown as { name: string } | null)?.name || v.name;
  await raiseIncident({
    kind: "trainer_report", urgent: true, ref: `ireport:${rep.id}`, chatId: chat.id, bookingId: b.id, link: `${site()}/a/dogs/${b.id}#incident-reports`,
    title: `${kind}: ${b.dog_name || "dog"} (${b.client_name}), ${trainer}`,
    detail: `${v.name} reported: ${kind}, ${occurred.replace("T", " ")}. What happened: ${what} What they did: ${action} Vet: ${vet ? `yes (${vetDetails})` : "no"}. Client told: ${told ? "yes" : "no"}.`
  }, sb);
  revalidatePath("/", "layout");
  return { ok: true, message: "Sent to the Dogwise team. They've been emailed and will call you if needed. Post any photos in the chat." };
}
