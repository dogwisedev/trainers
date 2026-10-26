import { requireRole } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { recentMonths, salesMonth } from "@/lib/sales";
import { salesTeam } from "@/lib/hubspot";
import { etParts } from "@/lib/chatRules";
import { SalesView, monthLabel } from "@/components/SalesView";
import { SalesImport, SalesTeam } from "@/components/SalesAdminBits";

export const dynamic = "force-dynamic";

// Admin: sales by month and person (Closed Won deals booked in the app), with the remaining balance.
export default async function Sales({ searchParams }: { searchParams: { m?: string } }) {
  await requireRole("admin");
  const today = etParts(new Date()).date, months = recentMonths(today.slice(0, 7));
  const month = searchParams.m && /^\d{4}-\d{2}$/.test(searchParams.m) ? searchParams.m : months[0];
  const [data, team, { data: profs }] = await Promise.all([
    salesMonth(month), salesTeam().catch(() => []),
    isDemo() ? Promise.resolve({ data: [] }) : serviceClient().from("profiles").select("hubspot_owner_id").eq("role", "sales")
  ]);
  const withLogin = new Set(((profs || []) as { hubspot_owner_id: string | null }[]).map((p) => p.hubspot_owner_id));
  return (
    <>
      <h1 className="text-h1 font-extrabold leading-tight">Sales</h1>
      <p className="mt-1 text-ink-soft">Closed Won deals by the month they were won, per sales person. Remaining balance is what&apos;s still to be paid.</p>
      <SalesView month={month} months={months} base="/a/sales" {...data} admin />
      <div className="mt-8 space-y-3">
        <SalesTeam team={team.map((t) => ({ id: t.id, name: t.name, email: t.email, hasLogin: withLogin.has(t.id) }))} />
        <SalesImport month={month} today={today} monthName={monthLabel(month)} through={data.importedThrough} />
        {data.importedThrough && <p className="px-1 text-caption text-ink-faint">Sales up to {data.importedThrough} come from the Monies sheet; after that, from the app.</p>}
      </div>
    </>
  );
}
