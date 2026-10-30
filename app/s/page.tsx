import { requireRole } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { ownerByEmail, recentMonths, salesMonth } from "@/lib/sales";
import { etParts } from "@/lib/chatRules";
import { SalesView } from "@/components/SalesView";
import { SalesExtensions } from "@/components/SalesExtensions";
import { SalesInsightsView } from "@/components/SalesInsightsView";
import { salesInsightsCached } from "@/lib/salesInsights";
import { isSalesManager } from "@/lib/salesManager";

export const maxDuration = 60;

export const dynamic = "force-dynamic";
// A sales person: their own sales, by month.
export default async function MySales({ searchParams }: { searchParams: { m?: string; owed?: string } }) {
  const v = await requireRole("sales");
  const today = etParts(new Date()).date, months = recentMonths(today.slice(0, 7));
  const month = searchParams.m && /^\d{4}-\d{2}$/.test(searchParams.m) ? searchParams.m : months[0];
  // Who you are in HubSpot: the owner with your login email (falls back to the owner saved when your login was made)
  const owner = isDemo() ? null : await ownerByEmail(v.email);
  const { data: p } = owner || isDemo() ? { data: null } : await serviceClient().from("profiles").select("hubspot_owner_id").eq("id", v.userId).maybeSingle();
  const ownerId = owner?.id || p?.hubspot_owner_id || null;
  // A sales manager (SALES_MANAGER_EMAILS) sees the whole team, as admin does; everyone else sees their own sales
  const manager = isSalesManager(v.email);
  const [data, insights] = await Promise.all([
    manager ? salesMonth(month) : ownerId ? salesMonth(month, ownerId) : Promise.resolve({ sellers: [], total: 0, remaining: 0, owed: 0, count: 0 }),
    manager && !isDemo() ? salesInsightsCached(month, today).catch(() => null) : Promise.resolve(null)
  ]);
  return (
    <>
      <h1 className="text-h1 font-extrabold leading-tight">{manager ? "Sales" : `Hi ${v.name.split(" ")[0]}`}</h1>
      <p className="mt-1 text-ink-soft">{manager ? "The whole team: Closed Won deals by the month they were won." : "Your sales: Closed Won deals by the month they were won."}</p>
      <div className="mt-4"><SalesExtensions admin={manager} /></div>
      {insights && <SalesInsightsView s={insights} admin={false} />}
      {manager && <h2 className="mt-8 text-lead font-extrabold">Sales by person</h2>}
      <SalesView month={month} months={months} base="/s" {...data} admin={manager} onlyOwed={searchParams.owed === "1"} />
    </>
  );
}
