"use server";
import { auditCall } from "@/lib/audit";
import { isDemo } from "@/lib/supabase";
import { contactFromToken, formsLink, saveForm, setFormDogs } from "@/lib/clientForms";
import { contactByEmail, hubspotConfigured } from "@/lib/hubspot";
import { mailConfigured, sendMail } from "@/lib/mail";

type R = { ok: boolean; message: string };

/** The client's form: save one section (their details, or one dog's). The link itself says who they are. */
export async function saveFormAction(token: string, dogKey: string | null, values: Record<string, string>): Promise<R> {
  if (isDemo()) return { ok: false, message: "Demo mode." };
  const id = contactFromToken(token);
  if (!id) return { ok: false, message: "This link isn't valid. Use the link in your latest Dogwise email." };
  const r = await saveForm(id, dogKey, values);
  await auditCall("clientFormSaved", { contact: id, section: dogKey ? `dog: ${dogKey}` : "your details", answers: Object.keys(values).length }, { name: `Client (HubSpot contact ${id})`, role: "client" }, { ok: r.ok, error: r.ok ? null : r.message });
  return r;
}

export async function setFormDogsAction(token: string, names: string[]): Promise<R> {
  if (isDemo()) return { ok: false, message: "Demo mode." };
  const id = contactFromToken(token);
  if (!id) return { ok: false, message: "This link isn't valid." };
  return setFormDogs(id, names);
}

/** The general page (for when a template had no personal link): sends the link to the email HubSpot has. Never makes a contact. */
export async function requestFormLinkAction(_: R | null, f: FormData): Promise<R> {
  if (isDemo()) return { ok: false, message: "Demo mode." };
  const email = String(f.get("email") || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: "Type the email you gave Dogwise." };
  if (!hubspotConfigured() || !mailConfigured()) return { ok: false, message: "Not set up yet. Please reply to your Dogwise email." };
  const c = await contactByEmail(email).catch(() => null);
  await auditCall("clientFormLinkRequested", { email, found: c ? "yes" : "no" }, { name: email, role: "client" }, { ok: !!c, error: c ? null : "No HubSpot contact with that email" });
  if (!c) return { ok: false, message: "We couldn't find that email. Please reply to your Dogwise email and we'll send your link." };
  const link = formsLink(c.id);
  await sendMail({ to: c.email, subject: "Your Dogwise before-training questions",
    text: `Here's your personal link for your dog's before-training questions:\n${link}\n\nIt saves as you go, so you can come back to it any time.`,
    html: `<p>Here's your personal link for your dog's before-training questions:</p><p><a href="${link}">Open my questions</a></p><p>It saves as you go, so you can come back to it any time.</p>` });
  return { ok: true, message: `Sent. Check ${c.email} for your link.` };
}
