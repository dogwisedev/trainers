import "server-only";
import { serviceClient } from "./supabase";
import { DEFAULT_VIEWS } from "./dogFilters";

export type DogView = { id: string; name: string; query: string; mine: boolean };
/** The office's saved Dogs views (migration 047). Before it's run, the starting views, read-only. */
export async function listDogViews(): Promise<{ views: DogView[]; editable: boolean }> {
  const { data, error } = await serviceClient().from("dog_views").select("id, name, query").order("sort").order("created_at");
  if (error) return { views: DEFAULT_VIEWS.map((v, i) => ({ id: `default-${i}`, ...v, mine: false })), editable: false };
  return { views: ((data || []) as { id: string; name: string; query: string }[]).map((v) => ({ ...v, mine: true })), editable: true };
}
