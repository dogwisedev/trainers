import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { aiTest } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Signed in as an admin, open /api/ai/test: one tiny question goes to Claude with each kind of model the app uses, and
// this shows exactly what came back (the model that works, or Claude's own error: key, credit, model name).
export async function GET() {
  const v = await getViewer().catch(() => null);
  if (!v || v.role !== "admin") return NextResponse.json({ error: "Sign in as an admin first." }, { status: 401 });
  const r = await aiTest();
  const ok = !!r.writing.working && !!r.labelling.working;
  return NextResponse.json({ ok, summary: !r.keySet ? "ANTHROPIC_API_KEY isn't set in Vercel (or the app wasn't redeployed after adding it)." : ok ? "Claude is answering. The AI help can run." : "Claude isn't answering: see the errors below.", ...r }, { status: ok ? 200 : 502 });
}
