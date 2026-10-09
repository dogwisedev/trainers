import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import seed from "./demo-seed.json";
import { isDemo, serverClient } from "./supabase";
import { addDays, todayIso } from "./dates";
import { BookingLike, EMPTY_RATES, Rates, draftLines, payMondayOnOrBefore, runDates, sumLines } from "./payroll";
import { SlipData, SlipLine } from "./payslipDoc";
import { Trainer } from "./types";

export type Line = SlipLine & { id?: string; booking_id?: string | null; week_from?: number | null; auto?: boolean; missingRate?: boolean };
export type Slip = {
  id: string; pay_run_id: string; trainer_id: string; status: "draft" | "approved"; adjustments: number; notes: string | null;
  subtotal: number; total: number; trainer_name: string | null; trainer_address: string | null;
  approved_by_name: string | null; approved_at: string | null; sent_at: string | null; sent_to: string | null; send_error: string | null;
};
export type Run = { id: string; submit_date: string; period_start: string; period_end: string; paid_date: string };

/** Run on screen: the latest pay Monday, until the next one comes round. */
export const defaultRunDate = () => payMondayOnOrBefore(todayIso());

// ── Demo (no database): drafts computed on the fly with example rates ───
const DEMO_RATES: Rates = { w2: 470, w3: 466.67, w4: 470, w4_rehab: 470, w5_rehab: 500, w6_rehab: 550, report_deduction: 100 };
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
  const [{ data: trainers }, { data: bookings }, { data: rateRows }, { data: existing }] = await Promise.all([
    sb.from("trainers").select("id, name, address"),
    sb.from("bookings").select("id, trainer_id, client_name, dog_name, start_date, end_date, weeks, extra_days, rehab, status").neq("status", "cancelled").lte("start_date", lastDay).gte("end_date", r.weeks[0]),
    sb.from("trainer_rates").select("*"),
    sb.from("payslips").select("id, trainer_id, status, adjustments").eq("pay_run_id", run.id)
  ]);
  const rateOf = (id: string) => { const x = (rateRows || []).find((q) => q.trainer_id === id); return x ? { ...EMPTY_RATES, ...x, report_deduction: Number(x.report_deduction ?? 100) } as Rates : EMPTY_RATES; };
  let built = 0, skipped = 0, missingRates = 0;

  for (const t of trainers || []) {
    const lines = draftLines(((bookings || []) as BookingLike[]).filter((b) => b.trainer_id === t.id), rateOf(t.id), r.weeks);
    const prev = (existing || []).find((p) => p.trainer_id === t.id);
    if (prev?.status === "approved") { skipped++; continue; }
    if (!lines.length && !prev) continue;
    missingRates += lines.filter((l) => l.missingRate).length;

    let slipId = prev?.id;
    if (!slipId) {
      const { data: s, error } = await sb.from("payslips").insert({ pay_run_id: run.id, trainer_id: t.id, trainer_name: t.name, trainer_address: t.address }).select("id").single();
      if (error) throw new Error(error.message);
      slipId = s.id;
    }
    await sb.from("payslip_lines").delete().eq("payslip_id", slipId).eq("auto", true);
    if (lines.length) {
      const { error } = await sb.from("payslip_lines").insert(lines.map((l, i) => ({
        payslip_id: slipId, kind: "training", booking_id: l.booking_id, weeks_completed: l.weeks_completed, days: l.days, week_from: l.week_from,
        client: l.client, dog: l.dog, program: l.program, amount: l.amount, auto: true, sort: i,
        description: l.missingRate ? `No pay rate set for ${l.program}` : null
      })));
      if (error) throw new Error(error.message);
    }
    await recalc(sb, slipId!);
    built++;
  }
  return { run, built, skipped, missingRates };
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
export async function getRun(submitDate: string) {
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
