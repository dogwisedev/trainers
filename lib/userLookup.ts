import "server-only";
import { serviceClient } from "./supabase";

// Quick lookups straight from the database (migration 023), instead of listing every account through the login service.
export async function userIdByEmail(email: string): Promise<string | null> {
  const sb = serviceClient();
  const { data, error } = await sb.rpc("user_id_by_email", { p_email: email.trim() });
  if (!error) return (data as string | null) || null;
  // Migration 023 not run yet: the old, slower way (first 1000 accounts only)
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return list?.users.find((u) => u.email?.toLowerCase() === email.trim().toLowerCase())?.id || null;
}
export async function lastSignIns(ids: string[]): Promise<Map<string, string | null> | null> {
  if (!ids.length) return new Map();
  const { data, error } = await serviceClient().rpc("last_sign_ins", { p_ids: ids });
  if (error) return null; // unknown: callers show nothing rather than guess
  return new Map(((data || []) as { id: string; last_sign_in_at: string | null }[]).map((r) => [r.id, r.last_sign_in_at]));
}
