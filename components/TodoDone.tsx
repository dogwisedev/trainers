"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { resolveIncidentAction } from "@/app/chat-actions";

/** "Done" on a To do item: closes it (it's recorded who did it, and when). */
export function TodoDone({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <span className="inline-flex flex-col">
      <button type="button" className="btn-ghost h-9 min-h-0 px-3 text-[13px]" disabled={pending}
        onClick={() => start(async () => { const r = await resolveIncidentAction(id, ""); if (r.ok) router.refresh(); else setErr(r.message); })}>
        <Check size={15} />{pending ? "…" : "Done"}
      </button>
      {err && <span className="mt-1 text-[12px] text-heart">{err}</span>}
    </span>
  );
}
