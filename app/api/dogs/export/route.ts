import { NextResponse, type NextRequest } from "next/server";
import { getViewer, listTrainers } from "@/lib/data";
import { TABS, type Tab, bookingHistory } from "@/lib/history";
import { readinessFor } from "@/lib/pretraining";
import { salesPeople } from "@/lib/sales";
import { DOT_LABEL } from "@/lib/programStrip";
import { todayIso } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Dogs → Export CSV: whatever chip, trainer, POC and search is showing, as a spreadsheet (what the HubSpot reports
// gave the office): the program, the people, the money, and every form and follow-up, in plain words.
const csv = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export async function GET(req: NextRequest) {
  const v = await getViewer();
  if (v?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 401 });
  const sp = req.nextUrl.searchParams, tab = (TABS.some((x) => x.key === sp.get("f")) ? sp.get("f") : "now") as Tab;
  const t = sp.get("t") || "", q = (sp.get("q") || "").trim(), poc = (sp.get("p") || "").trim();
  const trainers = await listTrainers({ includeInactive: true });
  const pocIds = poc ? trainers.filter((x) => String(x.poc || "").trim().toLowerCase() === poc.toLowerCase()).map((x) => x.id) : undefined;
  const [{ rows }, people] = await Promise.all([bookingHistory({ tab, q, trainerId: t || undefined, trainerIds: pocIds, admin: true, limit: 2000 }), salesPeople().catch(() => [])]);
  const ready = tab === "now" || tab === "upcoming" ? await readinessFor(rows.map((r) => r.id)).catch(() => new Map()) : new Map();
  const owner = new Map(people.map((o) => [o.id, o.name]));
  const head = ["Deal ID", "Dog", "Client", "Email", "Trainer", "POC", "Program", "Weeks", "Start", "End", "Status", "Before training", "Amount", "Paid", "Owed", "Payment status", "Salesperson",
    "Intake", "Week 1", "Week 2", "Week 3", "Week 4", "Week 5", "Week 6", "Handover", "Follow-up 1", "Follow-up 2", "Follow-up 3", "Cancel reason", "HubSpot"];
  const label = TABS.find((x) => x.key === tab)?.label || tab;
  const lines = rows.map((b) => {
    const s = b.strip, r = ready.get(b.id) as { ready: { missing: unknown[] }; dog: { cleared?: boolean } } | undefined;
    const before = r ? (r.ready.missing.length ? `${r.ready.missing.length} missing` : r.dog.cleared ? "OK to start" : "Ready") : "";
    const w = (i: number) => (s && s.weeks[i] ? DOT_LABEL[s.weeks[i]] : "");
    return [b.hubspot_deal_id || "", b.dog_name || "", b.client_name, b.client_email || "", b.trainers?.name || "", b.poc || "", b.program || `${b.weeks}-week`, b.weeks, b.start_date, b.end_date,
      b.status === "cancelled" ? "Cancelled" : label, before, s?.paid?.amount ?? "", s?.paid?.paid ?? "", s?.paid?.owed ?? "", s?.paid?.status || "", (b.owner && owner.get(b.owner)) || "",
      s ? DOT_LABEL[s.intake] : "", w(0), w(1), w(2), w(3), w(4), w(5), s ? DOT_LABEL[s.handover] : "", ...(s ? s.fups.map((d) => DOT_LABEL[d]) : ["", "", ""]), b.cancelReason || "",
      b.hubspot_deal_id ? `https://app.hubspot.com/contacts/21869370/record/0-3/${b.hubspot_deal_id}` : ""].map(csv).join(",");
  });
  const body = "\uFEFF" + [head.join(","), ...lines].join("\r\n"); // the byte-order mark makes Excel read the accents right
  const name = `dogs-${label.toLowerCase().replace(/\s+/g, "-")}${poc ? `-${poc.toLowerCase()}` : ""}-${todayIso()}.csv`;
  return new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
