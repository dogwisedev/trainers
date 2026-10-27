import { requireRole } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { recentMonths, salesMonth } from "@/lib/sales";
import { salesTeam } from "@/lib/hubspot";
import { etParts } from "@/lib/chatRules";
import { SalesView } from "@/components/SalesView";
import { SalesRefresh, SalesTeam } from "@/components/SalesAdminBits";
import { lastSalesSync } from "@/lib/salesSync";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // "Refresh from HubSpot" runs here and can take up to a minute

// Admin: sales by month and person, straight from HubSpot (every Closed Won deal), with what is still owed.
export default async function Sales({ searchParams }: { searchParams: { m?: string; owed?: string } }) {
  await requireRole("admin");
  const today = etParts(new Date()).date, months = recentMonths(today.slice(0, 7));
  const month = searchParams.m && /^\d{4}-\d{2}$/.test(searchParams.m) ? searchParams.m : months[0];
  const [data, team, { data: profs }, last] = await Promise.all([
    salesMonth(month), salesTeam().catch(() => []),
    isDemo() ? Promise.resolve({ data: [] }) : serviceClient().from("profiles").select("display_name, hubspot_owner_id").eq("role", "sales"),
    lastSalesSync()
  ]);
  const logins = (profs || []) as { display_name: string | null; hubspot_owner_id: string | null }[];
  const withLogin = new Set(logins.map((p) => p.hubspot_owner_id));
  // A sales login that isn't linked to someone in the HubSpot sales team sees no sales on their page
  const teamIds = new Set(team.map((t) => t.id));
  const unlinked = team.length ? logins.filter((p) => !p.hubspot_owner_id || !teamIds.has(p.hubspot_owner_id)) : [];
  return (
    <>
      <h1 className="text-h1 font-extrabold leading-tight">Sales</h1>
      <p className="mt-1 text-ink-soft">From HubSpot: every Closed Won deal, by the month it was won (Eastern time), under the deal owner. Still owed = amount minus amount paid, unless the deal is marked Paid, Refund or Program Cancelled.</p>
      <SalesRefresh last={last} />
      <SalesView month={month} months={months} base="/a/sales" {...data} admin onlyOwed={searchParams.owed === "1"} />
      <div className="mt-8 space-y-3">
        {unlinked.length > 0 && (
          <p role="alert" className="rounded-xl bg-heart-wash px-3.5 py-2.5 text-small text-heart">
            <b>{unlinked.map((p) => p.display_name || "A sales login").join(", ")}</b>: {unlinked.length > 1 ? "these logins aren't" : "this login isn't"} linked to anyone in the HubSpot sales team, so {unlinked.length > 1 ? "their pages show" : "their page shows"} no sales. Send them a new link from the sales team list below.
          </p>
        )}
        <SalesTeam team={team.map((t) => ({ id: t.id, name: t.name, email: t.email, hasLogin: withLogin.has(t.id) }))} />
      </div>
    </>
  );
}
