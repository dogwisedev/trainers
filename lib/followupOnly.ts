import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// "Follow-up only" bookings (migration 065): a dog whose program finished before the app, added for its follow-up
// sessions. They're left out of program pay, Pulse, ratings and both HubSpot syncs; forms and training videos are off on
// the booking itself, and their dates are always in the past, so nothing "in care" ever sees them.
/** The ids of follow-up-only bookings (none before migration 065). */
export async function followupOnlyIds(sb: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await sb.from("bookings").select("id").eq("followup_only", true).limit(5000);
  return error ? new Set() : new Set(((data || []) as { id: string }[]).map((b) => b.id));
}
