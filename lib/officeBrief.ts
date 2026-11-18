import "server-only";
import { serviceClient } from "./supabase";
import { buildTodo, type TodoItem } from "./todo";
import { addDays, todayIso } from "./dates";

// The office brief: To do in the sections a post wants, with "new" or "still open, day N" on each item, so it can be
// posted twice a day in one call with nothing to judge. `onlyNew` returns just what has appeared since that caller's last
// new-only call: a cheap hourly feed. The "since" marker is kept PER CALLER (`caller`), so a test, a second agent or the
// app's own poster never uses up another caller's new items. A full brief never moves the new-only marker.

type Line = { text: string; detail?: string; owner?: string; since?: string; days: number; status: "new" | "still open"; link?: string; history?: string[]; suggested?: string };
const callerKey = (c: string) => c.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "default";

export async function officeBrief(o: { onlyNew?: boolean; site: string; caller?: string }) {
  const sb = serviceClient();
  const key = `brief.${o.onlyNew ? "new" : "full"}.${callerKey(o.caller || "default")}`;
  const { data: last } = await sb.from("app_settings").select("value").eq("key", key).maybeSingle();
  const lastAt = typeof last?.value === "string" ? last.value : new Date(Date.now() - 24 * 3600e3).toISOString();
  const now = new Date().toISOString();
  const d = await buildTodo();
  const line = (i: TodoItem): Line => {
    const since = i.since || now, days = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 864e5));
    return { text: i.text, detail: i.detail, owner: i.poc, since, days, status: since > lastAt ? "new" : "still open", link: i.primary?.href ? (/^https?:/.test(i.primary.href) ? i.primary.href : `${o.site}${i.primary.href}`) : undefined,
      history: i.chase?.history?.length ? i.chase.history : undefined, suggested: i.chase?.suggested };
  };
  const pick = (f: (i: TodoItem) => boolean) => d.items.filter(f).map(line).filter((l) => !o.onlyNew || l.status === "new");
  const sections = {
    decisions: pick((i) => !!i.decision),
    calls: pick((i) => !!i.chase && !i.decision),                                   // handed to the office after the app's reminders
    urgent: pick((i) => i.clear === "handled" && /needs a person now/.test(i.text)),
    officeQuestions: pick((i) => i.clear === "handled" && !/needs a person now/.test(i.text) && !i.decision),
    worriesAddingUp: pick((i) => i.key.startsWith("pattern:")),
    trainerInbox: pick((i) => !!i.readTrainer),
    startingSoon: pick((i) => /^(Not ready|.* starts? (today|tomorrow)|Check .* vaccines)/i.test(i.text) || i.key.startsWith("ready:")),
  };
  // Going home within 3 days, with the handover's state
  const today = todayIso();
  const { data: home } = await sb.from("bookings").select("id, dog_name, client_name, end_date, trainers(name)").neq("status", "cancelled").gte("end_date", today).lte("end_date", addDays(today, 3)).order("end_date");
  const ids = ((home || []) as { id: string }[]).map((b) => b.id);
  const { data: hov } = ids.length ? await sb.from("reports").select("booking_id, status, ai_draft").eq("kind", "handover").in("booking_id", ids) : { data: [] };
  const goingHome = ((home || []) as unknown as { id: string; dog_name: string | null; client_name: string; end_date: string; trainers: { name: string } | null }[]).map((b) => {
    const r = ((hov || []) as { booking_id: string; status: string; ai_draft: { fields?: unknown; thin?: boolean } | null }[]).find((x) => x.booking_id === b.id);
    const state = !r ? "handover not started" : r.status === "approved" ? "handover approved" : r.status === "submitted" ? "handover in, to review" : r.ai_draft?.fields ? "handover drafted by the app, with the trainer" : r.ai_draft?.thin ? "handover empty (too few updates to draft)" : "handover started";
    return { dog: b.dog_name || "Dog", client: b.client_name, trainer: b.trainers?.name || "?", goesHome: b.end_date, state, link: `${o.site}/a/dogs/${b.id}?tab=forms` };
  });
  const { count: chasing } = await sb.from("nudges").select("id", { count: "exact", head: true }).is("done_at", null).lt("step", 3);
  const counts = { todo: d.items.length + (d.beforeApp.length ? 1 : 0), chasing: chasing || 0, lateForms: d.late.length };
  await sb.from("app_settings").upsert({ key, value: now, updated_by: "app", updated_at: now }, { onConflict: "key" }).then(() => null, () => null);
  const empty = Object.values(sections).every((s) => s.length === 0);
  return {
    at: now, since: lastAt, caller: callerKey(o.caller || "default"), mode: o.onlyNew ? "new since this caller's last new-only call" : "everything open",
    how: "Each item is already on the app's To do with its owner (owner = the trainer's POC; decisions = Sean). Post the sections that have items; collapse 'still open' ones to one line with the day count; never ask anyone to chase a trainer the app is still reminding (counts.chasing). Nothing here needs judging: the app has read the messages.",
    ...sections, goingHome: o.onlyNew ? goingHome.filter((g) => g.state === "handover not started" || g.state.startsWith("handover empty")) : goingHome, counts,
    nothing: empty ? (o.onlyNew ? "Nothing new since the last call." : "Nothing needs a person right now.") : undefined
  };
}
