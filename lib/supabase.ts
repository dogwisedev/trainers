import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

type CookieSet = { name: string; value: string; options?: Record<string, unknown> }[];

/** Every Supabase call gives up after 20 seconds, so a slow database shows an error instead of hanging the page. */
const timed = { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(20000) }) };

// The app's own key, sent with every database request the server makes for a signed-in person.
// The database logs any change to bookings, trainers, pay and the like that arrives WITHOUT it: someone editing
// straight from a browser console or a script with their login, instead of through the app (migration 033).
// The key is made by the database and kept in app_state, which browsers can't read; the server fetches it once.
let writeKey: { v: string | null; at: number } | null = null;
async function appKey(): Promise<string | null> {
  if (writeKey && Date.now() - writeKey.at < 10 * 60e3) return writeKey.v;
  try {
    const { data } = await serviceClient().from("app_state").select("value").eq("key", "db_write_key").maybeSingle();
    writeKey = { v: (data?.value as string | null) || null, at: Date.now() };
  } catch { writeKey = { v: writeKey?.v ?? null, at: Date.now() - 9 * 60e3 }; } // try again in a minute
  return writeKey.v;
}
const keyed = {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = await appKey();
    const headers = new Headers(init?.headers);
    if (key) headers.set("x-dogwise-key", key);
    return fetch(input, { ...init, headers, signal: init?.signal || AbortSignal.timeout(20000) });
  }
};

export const isDemo = () => !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Server client acting as the signed-in user (row level security applies). */
export function serverClient() {
  const store = cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: keyed,
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
