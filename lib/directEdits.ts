import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { LOG_VIEWERS } from "./audit";
import { mailConfigured, sendMail } from "./mail";

// Changes made straight to the database with someone's login (browser console, scripts), not through the app,
// are written to the activity log by the database itself (migration 033). This emails them to the log viewers
// (alma@dogwiseacademy.com) within 10 minutes, and only to them, so whoever made the change isn't tipped off.
export const DIRECT_EDIT = "Changed data directly, not through the app";
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export async function watchDirectEdits(sb: SupabaseClient = serviceClient()) {
  const { data: st } = await sb.from("app_state").select("value").eq("key", "direct_edits_seen").maybeSingle();
  const since = Number(st?.value || 0);
  const { data, error } = await sb.from("audit_log").select("id, at, who, detail").eq("action", DIRECT_EDIT).gt("id", since).order("id").limit(50);
  if (error || !data?.length) { if (!st) await sb.from("app_state").upsert({ key: "direct_edits_seen", value: "0", updated_at: new Date().toISOString() }); return 0; }
  const rows = data as { id: number; at: string; who: string | null; detail: string | null }[];
  // Mark them seen first, so they can never be emailed twice
  await sb.from("app_state").upsert({ key: "direct_edits_seen", value: String(rows[rows.length - 1].id), updated_at: new Date().toISOString() });
  if (!mailConfigured()) return rows.length;
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const day = new Date(rows[0].at).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const link = `${site()}/a/log?d=${day}&type=problem`;
  await sendMail({
    to: LOG_VIEWERS().join(", "),
    subject: `Data changed outside the app: ${rows.length} change${rows.length > 1 ? "s" : ""}`,
    text: `These changes were made straight to the database with a Dogwise login, not through the app:\n\n${rows.map((r) => `${when(r.at)} ET, ${r.who}: ${r.detail}`).join("\n")}\n\nActivity log: ${link}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px"><p style="font-size:16px;font-weight:bold;color:#904B27">Data changed outside the app</p><p style="color:#333">These changes were made straight to the database with a Dogwise login (browser console or a script), not through the app:</p>${rows.map((r) => `<p style="font-size:14px;color:#333;margin:0 0 10px"><b>${esc(when(r.at))} ET, ${esc(r.who || "?")}</b><br>${esc(r.detail || "")}</p>`).join("")}<p><a href="${link}" style="color:#6E4FE0;font-weight:bold">Open the activity log</a></p></div>`
  });
  return rows.length;
}
