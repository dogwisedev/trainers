"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ShieldQuestion, X } from "lucide-react";
import { answerAskAction } from "@/app/actions";
import { DealDecision } from "@/components/DealDecision";

// To do rows for Assign or Ask: "Check with Jerry" (the POC on shift) and "Ask Pedro".
export function AskDecision({ id, kind, expired, trainer, dealId }: { id: string; kind: "offer" | "pedro"; expired: boolean; trainer: string; dealId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const first = trainer.split(" ")[0] || "them";
  const go = (a: "yes" | "no" | "approved" | "elsewhere" | "nobody") => start(async () => { const r = await answerAskAction(id, a); setMsg({ ok: r.ok, text: r.message }); if (r.ok && r.href) router.push(r.href); else if (r.ok) router.refresh(); });
  return (
    <div className="mt-2 w-full">
      <div className="flex flex-wrap gap-2">
        {kind === "offer" && !expired && <button type="button" disabled={pending} onClick={() => go("yes")} className="btn-ink h-9 min-h-0 px-3 text-small"><Check size={15} />{first} said yes: book it</button>}
        {kind === "offer" && <button type="button" disabled={pending} onClick={() => go("no")} className="btn-ghost h-9 min-h-0 px-3 text-small"><X size={15} />{expired ? "Re-match" : `${first} said no: re-match`}</button>}
        {kind === "offer" && <button type="button" disabled={pending} onClick={() => go("nobody")} className="btn-ghost h-9 min-h-0 px-3 text-small"><ShieldQuestion size={15} />No one else fits: Pedro</button>}
        {kind === "pedro" && <button type="button" disabled={pending} onClick={() => go("approved")} className="btn-ink h-9 min-h-0 px-3 text-small"><Check size={15} />Approve {first}</button>}
        {kind === "pedro" && <button type="button" disabled={pending} onClick={() => go("elsewhere")} className="btn-ghost h-9 min-h-0 px-3 text-small">Someone else</button>}
      </div>
      {kind === "pedro" && <DealDecision dealId={dealId} bookHref={`/a/bookings/new?deal=${dealId}`} />}
      {msg && <p role="status" className={`mt-1 text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </div>
  );
}
