import "server-only";
import { serviceClient, isDemo } from "./supabase";
import { syncMoney } from "./money";
import { cronRan } from "./cronHealth";
import { auditSystem } from "./audit";

// Sales come from HubSpot through this sync: its own job (every 30 minutes, vercel.json) so it isn't squeezed by the
// booking-date sync, plus a "Refresh from HubSpot" button on the admin Sales page. Each run's result is kept
// (app_state sales_sync) and shown on the Sales page, so it's always clear when the numbers were last updated.
export type SalesSyncStatus = { at: string; deals: number; won: number; errors: string[]; by: string };

export async function runSalesSync(by: string): Promise<SalesSyncStatus> {
  const r = await syncMoney().catch((e) => ({ deals: 0, won: 0, links: [] as string[], errors: [(e as Error).message] }));
  const status: SalesSyncStatus = { at: new Date().toISOString(), deals: r.deals, won: r.won, errors: r.errors.slice(0, 5), by };
  if (!isDemo()) {
    await serviceClient().from("app_state").upsert({ key: "sales_sync", value: JSON.stringify(status), updated_at: status.at });
    await cronRan("sales", !r.errors.length, r.errors.slice(0, 3).join("; ") || null);
    if (r.errors.length) await auditSystem("Sales sync had problems", r.errors.slice(0, 3).join("; "), { ok: false, error: `${r.deals} deals saved` });
    if (r.links.length) await auditSystem("Made Stripe balance links", r.links.join("; "));
  }
  return status;
}

export async function lastSalesSync(): Promise<SalesSyncStatus | null> {
  if (isDemo()) return null;
  const { data } = await serviceClient().from("app_state").select("value").eq("key", "sales_sync").maybeSingle();
  try { return data?.value ? (JSON.parse(String(data.value)) as SalesSyncStatus) : null; } catch { return null; }
}
