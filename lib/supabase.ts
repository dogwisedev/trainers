import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

type CookieSet = { name: string; value: string; options?: Record<string, unknown> }[];

/** Every Supabase call gives up after 20 seconds, so a slow database shows an error instead of hanging the page. */
const timed = { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(20000) }) };

export const isDemo = () => !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Server client acting as the signed-in user (row level security applies). */
export function serverClient() {
  const store = cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: timed,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list: CookieSet) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* called from a server component */ } }
    }
  });
}

/** Service-role client: bypasses RLS. Only for admin-checked server code (invites, availability API). */
export function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false }, global: timed });
}
