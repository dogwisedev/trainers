import { requireRole } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { ownerByEmail, recentMonths, salesMonth } from "@/lib/sales";
import { etParts } from "@/lib/chatRules";
import { SalesView } from "@/components/SalesView";

export const dynamic = "force-dynamic";
// A sales person: their own sales, by month.
export default async function MySales({ searchParams }: { searchParams: { m?: string } }) {
  const v = await requireRole("sales");
  const today = etParts(new Date()).date, months = recentMonths(today.slice(0, 7));
  const month = searchParams.m && /^\d{4}-\d{2}$/.test(searchParams.m) ? searchParams.m : months[0];
  // Who you are in HubSpot: the owner with your login email (falls back to the owner saved when your login was made)
  const owner = isDemo() ? null : await ownerByEmail(v.email);
  const { data: p } = owner || isDemo() ? { data: null } : await serviceClient().from("profiles").select("hubspot_owner_id").eq("id", v.userId).maybeSingle();
  const ownerId = owner?.id || p?.hubspot_owner_id || null;
  const data = ownerId ? await salesMonth(month, ownerId) : { sellers: [], total: 0, remaining: 0, count: 0 };
  return (
    <>
      <h1 className="text-h1 font-extrabold leading-tight">Hi {v.name.split(" ")[0]}</h1>
      <p className="mt-1 text-ink-soft">Your sales: Closed Won deals by the month they were won.</p>
      <SalesView month={month} months={months} base="/s" {...data} admin={false} />
    </>
  );
}
