"use server";
import { revalidatePath } from "next/cache";
import { audited } from "@/lib/audit";
import { getViewer } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";

type R = { ok: boolean; message: string };
/** /a/terms: the Terms & Conditions text (and how data and the app are used) the agreement copy carries. Each save is a new version. */
export async function saveTermsAction(text: string, data: string): Promise<R> {
  return audited("saveTerms", { chars: text.length + data.length }, async () => {
    if (isDemo()) return { ok: false, message: "Demo mode." };
    const v = await getViewer();
    if (!v || v.role !== "admin") return { ok: false, message: "Admins only." };
    const version = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
    const by = v.name, now = new Date().toISOString(), sb = serviceClient();
    const { error } = await sb.from("app_settings").upsert([
      { key: "terms.text", value: text.trim().slice(0, 60000), updated_by: by, updated_at: now },
      { key: "terms.data", value: data.trim().slice(0, 20000), updated_by: by, updated_at: now },
      { key: "terms.version", value: version, updated_by: by, updated_at: now }
    ], { onConflict: "key" });
    revalidatePath("/a/terms");
    return error ? { ok: false, message: error.message } : { ok: true, message: `Saved as the version of ${version}. Clients who agree from now on get this copy.` };
  });
}
