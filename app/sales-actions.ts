"use server";
import { audited } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/data";
import { serviceClient, isDemo } from "@/lib/supabase";
import { salesTeam } from "@/lib/hubspot";
import { sendSignInLink } from "@/lib/authEmail";
import { userIdByEmail } from "@/lib/userLookup";
import { runSalesSync } from "@/lib/salesSync";

type R = { ok: boolean; message: string };
async function admin() { const v = await getViewer(); return v?.role === "admin" ? v : null; }

/** Admin: give a HubSpot sales-team member a login (they only see their own sales). */
export async function inviteSalesAction(ownerId: string): Promise<R> {
  return audited("inviteSalesAction", { ownerId }, async () => {
  if (isDemo() || !(await admin())) return { ok: false, message: "Admins only." };
  const o = (await salesTeam()).find((x) => x.id === ownerId);
  if (!o?.email) return { ok: false, message: "Not found in the HubSpot sales team." };
  const sb = serviceClient();
  let id = await userIdByEmail(o.email);
  if (!id) {
    const { data, error } = await sb.auth.admin.createUser({ email: o.email, email_confirm: true });
    if (error || !data.user) return { ok: false, message: error?.message || "Couldn't create the login." };
    id = data.user.id;
  }
  const user = { id };
  const { data: p } = await sb.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (p && p.role !== "sales") return { ok: false, message: `${o.name} already has a ${p.role} login.` };
  const { error } = await sb.from("profiles").upsert({ id: user.id, role: "sales", display_name: o.name, hubspot_owner_id: o.id });
  if (error) return { ok: false, message: error.message };
  try { await sendSignInLink(o.email); } catch (e) { return { ok: false, message: `Login made, but the email failed: ${(e as Error).message}` }; }
  revalidatePath("/a/sales");
  return { ok: true, message: `Sign-in link sent to ${o.email}.` };
});
}

/** Admin: pull every Closed Won deal's sale and payments from HubSpot now (the same as the 30-minute job). */
export async function refreshSalesAction(): Promise<R> {
  return audited("refreshSalesAction", {}, async () => {
    if (isDemo()) return { ok: false, message: "Demo mode." };
    const v = await admin();
    if (!v) return { ok: false, message: "Admins only." };
    const s = await runSalesSync(v.name);
    revalidatePath("/a/sales"); revalidatePath("/s");
    return s.errors.length
      ? { ok: false, message: `Saved ${s.deals} deals, with problems: ${s.errors.join("; ")}` }
      : { ok: true, message: `Updated: ${s.deals} deals read from HubSpot, ${s.won} of them Closed Won.` };
  });
}
