import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import seed from "./demo-seed.json";
import { isDemo, serverClient, serviceClient } from "./supabase";
import { addDays, todayIso } from "./dates";
import { BookingLike, EMPTY_RATES, PROBATION_NOTE, Rates, TripLike, applyProbation, heldFrom, draftLines, payMondayOnOrAfter, payMondayOnOrBefore, routeLines, runDates, sumLines } from "./payroll";
import { SlipData, SlipLine } from "./payslipDoc";
import { Trainer } from "./types";

export type Line = SlipLine & { id?: string; booking_id?: string | null; week_from?: number | null; auto?: boolean; missingRate?: boolean };
export type Slip = {
  id: string; pay_run_id: string; trainer_id: string; status: "draft" | "approved"; adjustments: number; notes: string | null;
  subtotal: number; total: number; trainer_name: string | null; trainer_address: string | null;
  approved_by_name: string | null; approved_at: string | null; sent_at: string | null; sent_to: string | null; send_error: string | null;
};
export type Run = { id: string; submit_date: string; period_start: string; period_end: string; paid_date: string };

/** Run on screen when nothing is chosen: the oldest run that still has payslips waiting for approval;
 *  once every payslip in it is approved it's archived and the next pay Monday's run takes its place. */
export async function currentRunDate(): Promise<string> {
  const upcoming = payMondayOnOrAfter(todayIso());
  if (isDemo()) return upcoming;
  const { data } = await serverClient().from("pay_runs").select("submit_date, payslips(status)").order("submit_date");
  const runs = (data || []) as { submit_date: string; payslips: { status: string }[] }[];
  const open = runs.find((r) => r.payslips.some((p) => p.status === "draft"));
  if (open) return open.submit_date;
  // Everything approved: move on to the first pay Monday after the newest finished run (or the upcoming one)
  const done = runs.filter((r) => r.payslips.length && r.payslips.every((p) => p.status === "approved")).map((r) => r.submit_date);
  const lastDone = done.length ? done[done.length - 1] : null;
  return lastDone && lastDone >= upcoming ? addDays(lastDone, 14) : upcoming;
}
/** Kept for the archive page: the pay Monday that's current by date. */
export const defaultRunDate = () => payMondayOnOrBefore(todayIso());

// ── Demo (no database): drafts computed on the fly with example rates ───
const DEMO_RATES: Rates = { w2: 940, w3: 1400, w4: 2000, w4_rehab: 2000, w5_rehab: 2500, w6_rehab: 3300, report_deduction: 100 };
const demo = seed as unknown as { trainers: Trainer[]; bookings: BookingLike[] };
function demoRun(submit: string) {
  const r = runDates(submit);
  const run: Run = { id: `run_${submit}`, ...r };
  const slips = demo.trainers.map((t) => {
    const lines = draftLines(demo.bookings.filter((b) => b.trainer_id === t.id), DEMO_RATES, r.weeks).map((l) => ({ ...l, pct: null, description: null, auto: true }));
    const subtotal = sumLines(lines);
    const slip: Slip = { id: `${submit}_${t.id}`, pay_run_id: run.id, trainer_id: t.id, status: "draft", adjustments: 0, notes: null, subtotal, total: subtotal,
      trainer_name: t.name, trainer_address: t.address, approved_by_name: null, approved_at: null, sent_at: null, sent_to: null, send_error: null };
    return { slip, lines, trainer: t };
  }).filter((x) => x.lines.length);
  return { run, slips };
}

// ── Rates ───────────────────────────────────────────────────────────────
export async function getRates(trainerId: string): Promise<Rates> {
  if (isDemo()) return DEMO_RATES;
  const { data } = await serverClient().from("trainer_rates").select("*").eq("trainer_id", trainerId).maybeSingle();
  return data ? { ...EMPTY_RATES, ...data, report_deduction: Number(data.report_deduction ?? 100) } as Rates : EMPTY_RATES;
}

// ── Building drafts ─────────────────────────────────────────────────────
/** Creates the run if needed and (re)builds every draft from bookings. Approved payslips are never touched; manual lines are kept. */
export async function buildDrafts(sb: SupabaseClient, submitDate: string) {
  const r = runDates(submitDate);
  const { data: run, error: runErr } = await sb.from("pay_runs").upsert({ submit_date: r.submit_date, period_start: r.period_start, period_end: r.period_end, paid_date: r.paid_date }, { onConflict: "submit_date" }).select("*").single();
  if (runErr) throw new Error(runErr.message);

  const lastDay = addDays(r.weeks[1], 6);
  const [{ data: trainers }, { data: bookings }, { data: rateRows }, { data: existing }, { data: tripRows }, { data: fupRows }] = await Promise.all([
    sb.from("trainers").select("id, name, address, probation, probation_release_run, probation_release_amount"),
    sb.from("bookings").select("id, trainer_id, client_name, dog_name, start_date, end_date, weeks, extra_days, rehab, status").neq("status", "cancelled").lte("start_date", lastDay).gte("end_date", r.weeks[0]),
    sb.from("trainer_rates").select("*"),
    sb.from("payslips").select("id, trainer_id, status, adjustments, total, payslip_lines(booking_id, kind, auto, days, weeks_completed, amount, program, client, dog)").eq("pay_run_id", run.id),
    // Trips in these two weeks (pickups, drop-offs, follow-up sessions), for mileage pay. No table yet = no mileage lines.
    sb.from("trips").select("id, trainer_id, booking_id, kind, trip_date, miles, bookings(client_name, dog_name)").gte("trip_date", r.weeks[0]).lte("trip_date", lastDay),
    // Follow-up sessions booked on the deal (follow_up_session__1..3) in these two weeks. No table yet = none.
    sb.from("deal_money").select("deal_id, followups").overlaps("followups", Array.from({ length: 14 }, (_, i) => addDays(r.weeks[0], i)))
  ]);
  const fupDeals = (fupRows || []) as { deal_id: string; followups: string[] }[];
  const { data: fupBookings } = fupDeals.length ? await sb.from("bookings").select("id, trainer_id, client_name, dog_name, hubspot_deal_id, start_date").in("hubspot_deal_id", fupDeals.map((d) => d.deal_id)).neq("status", "cancelled").order("start_date") : { data: [] };
  const trips = ((tripRows || []) as unknown as (TripLike & { bookings: { client_name: string; dog_name: string | null } | null })[]).map((t) => ({ ...t, client: t.bookings?.client_name || "", dog: t.bookings?.dog_name || "" }));
  const rateOf = (id: string) => { const x = (rateRows || []).find((q) => q.trainer_id === id); return x ? { ...EMPTY_RATES, ...x, report_deduction: Number(x.report_deduction ?? 100) } as Rates : EMPTY_RATES; };
  let built = 0, skipped = 0, missingRates = 0, unchanged = 0;
  type L = { booking_id: string | null; kind: string; auto: boolean; days?: number | null; amount: number | string; program?: string | null; client?: string | null; dog?: string | null };
  const sig = (l: L) => [l.kind, l.booking_id, l.days ?? "", Number(l.amount ?? 0).toFixed(2), l.program ?? "", l.client ?? "", l.dog ?? ""].join("|");

  for (const t of trainers || []) {
    const prev = (existing || []).find((p) => p.trainer_id === t.id) as { id: string; status: string; payslip_lines?: L[] } | undefined;
    // A booking line edited by hand stays as it is: don't add an automatic one next to it.
    const handEdited = new Set((prev?.payslip_lines || []).filter((l) => l.kind === "training" && !l.auto && l.booking_id).map((l) => l.booking_id));
    const tr = t as { id: string; probation?: string | null; probation_release_run?: string | null; probation_release_amount?: number | null };
    // Follow-up sessions: the trainer on the deal is paid their follow-up rate for each session date in the period
    const fups = fupDeals.flatMap((d) => {
      const b = ((fupBookings || []) as { id: string; trainer_id: string; client_name: string; dog_name: string | null; hubspot_deal_id: string }[]).find((x) => x.hubspot_deal_id === d.deal_id);
      if (!b || b.trainer_id !== t.id) return [];
      return d.followups.filter((x) => x >= r.weeks[0] && x <= lastDay).map((x) => ({ kind: "other", booking_id: b.id, client: b.client_name, dog: b.dog_name || "", program: `Follow-up session ${x.slice(5).replace("-", "/")}`,
        amount: Number(rateOf(t.id).followup_rate ?? 60), days: null, weeks_completed: null, week_from: null, missingRate: false }));
    });
    const release = tr.probation === "approved" && tr.probation_release_run === r.submit_date && Number(tr.probation_release_amount) > 0
      ? [{ kind: "other", booking_id: null, client: "", dog: "", program: "Probation approved: held 25% paid", amount: Number(tr.probation_release_amount), days: null, weeks_completed: null, week_from: null, missingRate: false }] : [];
    const lines = [
      ...applyProbation(draftLines(((bookings || []) as BookingLike[]).filter((b) => b.trainer_id === t.id && !handEdited.has(b.id)), rateOf(t.id), r.weeks), tr.probation === "on" || tr.probation === "declined"),
      ...fups, ...release,
      ...routeLines(trips.filter((x) => x.trainer_id === t.id), rateOf(t.id), r.weeks[0], addDays(lastDay, 1))
    ];
    if (prev?.status === "approved") { skipped++; continue; }
    if (!lines.length && !prev) continue;
    missingRates += lines.filter((l) => l.missingRate).length;
    // Nothing changed since the last refresh: leave it alone (keeps refreshing fast)
    if (prev) {
      const before = (prev.payslip_lines || []).filter((l) => l.auto).map(sig).sort().join("\n");
      const after = lines.map((l) => sig({ ...l, auto: true })).sort().join("\n");
      if (before === after) {
        // Lines unchanged; just make sure the stored total still matches them
        const p = prev as unknown as { total?: number; adjustments?: number };
        const sum = Math.round((sumLines(prev.payslip_lines || []) + Number(p.adjustments || 0)) * 100) / 100;
        if (Number(p.total ?? NaN) !== sum) await recalc(sb, prev.id);
        unchanged++; continue;
      }
    }

    let slipId = prev?.id;
    if (!slipId) {
      const { data: s, error } = await sb.from("payslips").insert({ pay_run_id: run.id, trainer_id: t.id, trainer_name: t.name, trainer_address: t.address }).select("id").single();
      if (error) throw new Error(error.message);
      slipId = s.id;
    }
    await sb.from("payslip_lines").delete().eq("payslip_id", slipId).eq("auto", true);
    if (lines.length) {
      const { error } = await sb.from("payslip_lines").insert(lines.map((l, i) => ({
        payslip_id: slipId, kind: l.kind, booking_id: l.booking_id, weeks_completed: l.weeks_completed, days: l.days, week_from: l.week_from,
        client: l.client, dog: l.dog, program: l.program, amount: l.amount, auto: true, sort: i,
        description: l.kind === "training" && l.missingRate ? `No pay rate set for ${l.program}` : ("description" in l ? (l as { description?: string | null }).description || null : null)
      })));
      if (error) throw new Error(error.message);
    }
    await recalc(sb, slipId!);
    built++;
  }
  return { run, built, skipped, missingRates, unchanged };
}

export async function recalc(sb: SupabaseClient, slipId: string) {
  const [{ data: lines }, { data: slip }] = await Promise.all([
    sb.from("payslip_lines").select("amount").eq("payslip_id", slipId),
    sb.from("payslips").select("adjustments").eq("id", slipId).single()
  ]);
  const subtotal = sumLines(lines || []);
  await sb.from("payslips").update({ subtotal, total: Math.round((subtotal + Number(slip?.adjustments || 0)) * 100) / 100 }).eq("id", slipId);
}

// ── Reading ─────────────────────────────────────────────────────────────
export type RunSlip = Slip & { name: string; lines: Line[]; lineCount: number; missing: number };
export async function getRun(submitDate: string): Promise<{ run: Run | null; slips: RunSlip[] }> {
  if (isDemo()) {
    const d = demoRun(submitDate);
    return { run: d.run, slips: d.slips.map((x) => ({ ...x.slip, name: x.trainer.name, lines: x.lines as Line[], lineCount: x.lines.length, missing: x.lines.filter((l) => l.missingRate).length })) };
  }
  const sb = serverClient();
  const { data: run } = await sb.from("pay_runs").select("*").eq("submit_date", submitDate).maybeSingle();
  if (!run) return { run: null, slips: [] };
  const { data: slips } = await sb.from("payslips").select("*, trainers(name), payslip_lines(*)").eq("pay_run_id", run.id);
  return {
    run: run as Run,
    slips: (slips || []).map((s: Record<string, unknown> & { trainers?: { name: string }; payslip_lines?: (Line & { sort: number })[] }) => ({
      ...(s as unknown as Slip), name: s.trainers?.name || (s.trainer_name as string) || "",
      lines: [...(s.payslip_lines || [])].sort((a, b) => a.sort - b.sort) as Line[],
      lineCount: s.payslip_lines?.length || 0,
      missing: (s.payslip_lines || []).filter((l) => l.kind === "training" && /^No pay rate/.test(l.description || "")).length
    })).sort((a, b) => a.name.localeCompare(b.name))
  };
}

export async function getPayslip(id: string) {
  if (isDemo()) {
    const [submit, tid] = id.split("_");
    const d = demoRun(submit), x = d.slips.find((s) => s.trainer.id === tid);
    if (!x) return null;
    return { slip: x.slip, run: d.run, lines: x.lines as Line[], trainer: x.trainer, rates: DEMO_RATES, bookings: demo.bookings.filter((b) => b.trainer_id === tid) };
  }
  const sb = serverClient();
  const { data: slip } = await sb.from("payslips").select("*").eq("id", id).maybeSingle();
  if (!slip) return null;
  const [{ data: run }, { data: lines }, { data: trainer }] = await Promise.all([
    sb.from("pay_runs").select("*").eq("id", slip.pay_run_id).single(),
    sb.from("payslip_lines").select("*").eq("payslip_id", id).order("sort"),
    sb.from("trainers").select("*").eq("id", slip.trainer_id).maybeSingle()
  ]);
  const r = run as Run;
  const [{ data: bookings }, rates] = await Promise.all([
    sb.from("bookings").select("id, trainer_id, client_name, dog_name, start_date, end_date, weeks, extra_days, rehab, status").eq("trainer_id", slip.trainer_id).neq("status", "cancelled").lte("start_date", addDays(r.period_start, 13)).gte("end_date", addDays(r.period_start, -21)),
    getRates(slip.trainer_id)
  ]);
  return { slip: slip as Slip, run: r, lines: (lines || []) as Line[], trainer: trainer as Trainer | null, rates, bookings: (bookings || []) as BookingLike[] };
}

export function toSlipData(slip: Slip, run: Run, lines: SlipLine[], trainer?: Trainer | null): SlipData {
  return {
    trainer_name: slip.trainer_name || trainer?.name || "", trainer_address: slip.trainer_address ?? trainer?.address ?? null,
    submit_date: run.submit_date, paid_date: run.paid_date, period_start: run.period_start, period_end: run.period_end,
    lines, subtotal: slip.subtotal, adjustments: slip.adjustments, total: slip.total, notes: slip.notes
  };
}

/** Trainer's own approved payslips (row level security only returns approved ones). */
export async function listMyPayslips(trainerId: string) {
  if (isDemo()) return [];
  const { data } = await serverClient().from("payslips").select("id, total, sent_at, approved_at, pay_runs(submit_date, paid_date, period_start, period_end)").eq("trainer_id", trainerId).eq("status", "approved");
  return ((data || []) as unknown as { id: string; total: number; pay_runs: Run }[]).sort((a, b) => b.pay_runs.paid_date.localeCompare(a.pay_runs.paid_date));
}

/** Past runs for the archive, newest first. */
export async function listRuns(limit = 26) {
  if (isDemo()) {
    const cur = defaultRunDate();
    return Array.from({ length: 4 }, (_, i) => { const d = demoRun(addDays(cur, -14 * (i + 1))); return { ...d.run, count: d.slips.length, approved: 0, total: d.slips.reduce((n, x) => n + x.slip.total, 0) }; });
  }
  const { data } = await serverClient().from("pay_runs").select("*, payslips(total, status)").order("submit_date", { ascending: false }).limit(limit);
  return ((data || []) as (Run & { payslips: { total: number; status: string }[] })[]).map((r) => ({
    ...r, count: r.payslips.length, approved: r.payslips.filter((p) => p.status === "approved").length, total: r.payslips.reduce((n, p) => n + Number(p.total || 0), 0)
  }));
}

/** Probation: 25% held so far, from approved payslips (lines paid at 75%). */
export async function probationHeld(trainerId: string): Promise<number> {
  const sb = serviceClient();
  const { data } = await sb.from("payslips").select("status, payslip_lines(amount, description)").eq("trainer_id", trainerId).in("status", ["approved", "sent"]);
  const lines = ((data || []) as { payslip_lines: { amount: number; description: string | null }[] }[]).flatMap((p) => p.payslip_lines).filter((l) => l.description === PROBATION_NOTE);
  return Math.round(lines.reduce((n, l) => n + heldFrom(Number(l.amount)), 0) * 100) / 100;
}
/** Trainings that count toward probation: bookings (one per dog) that have finished, not cancelled. */
export async function probationTrainings(trainerId: string): Promise<number> {
  const { count } = await serviceClient().from("bookings").select("id", { count: "exact", head: true }).eq("trainer_id", trainerId).neq("status", "cancelled").lte("end_date", todayIso());
  return count || 0;
}
