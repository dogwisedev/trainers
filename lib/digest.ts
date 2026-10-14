import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { etParts } from "./chatRules";
import { alertAdmins } from "./adminAlert";
import { buildTodo } from "./todo";

// One email a day to admins (from 8am Eastern): what's on the To do list. Replaces most one-off alert emails;
// only urgent things (a client waiting, money, overbooking, a dog not ready 2 days out) are still emailed straight away.
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const HOUR = Number(process.env.DIGEST_HOUR_ET || 8);

export async function sendDailyDigest(sb: SupabaseClient): Promise<boolean> {
  const { date, hour } = etParts(new Date()) as { date: string; hour: number };
  if (hour < HOUR) return false;
  const { data: st } = await sb.from("app_state").select("value").eq("key", "digest_date").maybeSingle();
  if (st?.value === date) return false;
  // Claim today first, so it can never go twice. No table yet (migration 019 not run) = no summary, rather than one every 10 minutes.
  const { error } = await sb.from("app_state").upsert({ key: "digest_date", value: date, updated_at: new Date().toISOString() });
  if (error) return false;
  const { items, late } = await buildTodo();
  const now = items.filter((i) => i.group === "now"), week = items.filter((i) => i.group === "week"), later = items.filter((i) => i.group === "later");
  const total = items.length + (late.length ? 1 : 0);
  if (!total) return false;
  const link = (href?: string) => (href && /^https?:/.test(href) ? href : `${site()}${href || "/a"}`);
  const lines = [
    ...now.slice(0, 12).map((i) => ({ text: `Now: ${i.text}`, link: link(i.primary?.href || i.dogHref) })),
    ...week.slice(0, 8).map((i) => ({ text: `This week: ${i.text}`, link: link(i.primary?.href || i.dogHref) })),
    ...(late.length ? [{ text: `${late.length} form${late.length > 1 ? "s are" : " is"} late`, link: `${site()}/a` }] : []),
    ...(later.length ? [{ text: `${later.length} more when you have a minute`, link: `${site()}/a` }] : [])
  ];
  const more = now.length - 12 + Math.max(0, week.length - 8);
  await alertAdmins(`To do today: ${total} thing${total > 1 ? "s" : ""}${now.length ? ` (${now.length} now)` : ""}`,
    `Good morning. Here's what needs a person today${more > 0 ? ` (and ${more} more on the list)` : ""}.`, lines, { label: "Open To do", link: `${site()}/a` });
  return true;
}
