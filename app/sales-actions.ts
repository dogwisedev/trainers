"use server";
import { audited } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/data";
import { serviceClient, isDemo } from "@/lib/supabase";
import { salesTeam } from "@/lib/hubspot";
import { matchOwner, parseSheetSales, salesPeople } from "@/lib/sales";
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

/** Admin: paste a month's rows from the Monies sheet (replaces that month's pasted rows). */
export async function importSalesAction(_: R | null, f: FormData): Promise<R> {
  return audited("importSalesAction", { f }, async () => {
  if (isDemo() || !(await admin())) return { ok: false, message: "Admins only." };
  const month = String(f.get("month") || ""), through = String(f.get("through") || "");
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: "Pick the month." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) return { ok: false, message: "Say which day these rows go up to." };
  const rows = parseSheetSales(String(f.get("rows") || ""));
  if (!rows.length) return { ok: false, message: "No sales found. Copy the rows from the sheet (name, client, program, amount…) and paste them." };
  const all = await salesPeople();
  const match = (name: string) => matchOwner(name, all);
  const sb = serviceClient();
  await sb.from("sales_import").delete().eq("month", `${month}-01`);
  const { error } = await sb.from("sales_import").insert(rows.map((r) => ({ month: `${month}-01`, seller: r.seller, owner_id: match(r.seller), client: r.client || null, program: r.program || null, amount: r.amount, paid_in_full: r.paidInFull })));
  if (error) return { ok: false, message: error.message };
  // The cut-over date only ever moves forward (importing an older month never hides newer app sales)
  const { data: cur } = await sb.from("app_state").select("value").eq("key", "sales_import_through").maybeSingle();
  if (!cur?.value || through > String(cur.value)) await sb.from("app_state").upsert({ key: "sales_import_through", value: through, updated_at: new Date().toISOString() });
  revalidatePath("/a/sales");
  const unmatched = [...new Set(rows.filter((r) => !match(r.seller)).map((r) => r.seller))];
  return { ok: true, message: `Imported ${rows.length} sales. Deals won after ${through} come from the app.${unmatched.length ? ` Not matched to a HubSpot owner: ${unmatched.join(", ")}.` : ""}` };
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
