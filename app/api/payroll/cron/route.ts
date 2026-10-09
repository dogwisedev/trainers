import { NextResponse } from "next/server";
import { serviceClient, isDemo } from "@/lib/supabase";
import { buildDrafts } from "@/lib/payrollData";
import { isPayMonday, money, periodLabel, usDate } from "@/lib/payroll";
import { sendMail, mailConfigured } from "@/lib/mail";

// Mondays 7am Eastern (vercel.json). On pay Mondays: builds the drafts and tells payroll they're ready.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isDemo()) return NextResponse.json({ skipped: "demo" });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); // YYYY-MM-DD
  if (!isPayMonday(today)) return NextResponse.json({ skipped: `${today} isn't a pay Monday` });
  const sb = serviceClient();
  const r = await buildDrafts(sb, today);
  const notify = process.env.PAYROLL_NOTIFY_EMAIL;
  if (notify && mailConfigured()) {
    const { data } = await sb.from("payslips").select("total").eq("pay_run_id", r.run.id);
    const total = (data || []).reduce((n, s) => n + Number(s.total || 0), 0);
    const link = `${process.env.NEXT_PUBLIC_SITE_URL || ""}/a/payroll?run=${today}`;
    await sendMail({
      to: notify, subject: `Payroll drafts ready: ${periodLabel(r.run.period_start, r.run.period_end)}`,
      text: `${(data || []).length} payslips, ${money(total)} in total, to be paid ${usDate(r.run.paid_date)}.${r.missingRates ? ` ${r.missingRates} lines need a pay rate.` : ""}\nReview and approve: ${link}`,
      html: `<p>${(data || []).length} payslips, <b>${money(total)}</b> in total, to be paid ${usDate(r.run.paid_date)}.${r.missingRates ? ` <b>${r.missingRates} lines need a pay rate.</b>` : ""}</p><p><a href="${link}">Review and approve</a></p>`
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, built: r.built, skipped: r.skipped, missingRates: r.missingRates });
}
