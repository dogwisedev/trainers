import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { getReport } from "@/lib/reportData";
import { s } from "@/lib/reports";
import { handoverFiles } from "@/lib/handoverFiles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Admin: see the client's handover report or certificate exactly as it will be sent, without sending anything. ?doc=report|certificate
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const v = await getViewer();
  if (v?.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const b = await getReport(params.id);
  if (!b || b.report.kind !== "handover") return NextResponse.json({ error: "Not a handover report." }, { status: 404 });
  const f = await handoverFiles(b, s(b.report.answers.clientEmail) || b.booking.client_email || "");
  const cert = new URL(req.url).searchParams.get("doc") === "certificate";
  return new NextResponse(Buffer.from(cert ? f.cert : f.pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${cert ? f.certName : f.reportName}"`, "Cache-Control": "no-store" } });
}
