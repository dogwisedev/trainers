"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { confirmMoveAction } from "@/app/actions";
import { PostponeTraining } from "@/components/PostponeTraining";
import { CancelTraining } from "@/components/CancelTraining";

// A To do row about a booked dog that didn't start (or finish) as planned: confirm it happened, Postpone (Standby), or
// Cancel the training, right there. Also on the dog page ("Mark picked up / home").
export function MarkMove({ bookingId, move }: { bookingId: string; move: "pickup" | "dropoff" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button type="button" disabled={pending} className="btn-ink h-9 min-h-0 px-3 text-small"
        onClick={() => start(async () => { const r = await confirmMoveAction(bookingId, move, true); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); })}>
        <Check size={15} />{move === "pickup" ? "Mark picked up" : "Mark home"}</button>
      {msg && <span className={`mt-1 text-caption ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</span>}
    </span>
  );
}

export function BookingDecision({ bookingId, move, dog, trainer, hasDeal }: { bookingId: string; move: "pickup" | "dropoff" | null; dog: string; trainer: string; hasDeal: boolean }) {
  return (
    <div className="mt-2 flex w-full flex-wrap items-start gap-2">
      {move && <MarkMove bookingId={bookingId} move={move} />}
      {move !== "dropoff" && hasDeal && <PostponeTraining bookingId={bookingId} dog={dog} />}
      {move !== "dropoff" && <CancelTraining bookingId={bookingId} dog={dog} trainer={trainer} />}
    </div>
  );
}
