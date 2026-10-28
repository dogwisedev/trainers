"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Pause, Play } from "lucide-react";
import { setProgramChoiceAction, setTrainingPausedAction } from "@/app/training-actions";

type Row = { title: string; kind: "video" | "file" | "photo"; on: string | null; status: "sent" | "skipped" | "planned"; phase: "during" | "after" };
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** Dog page: the program used, what's been sent and what's next, and pause. */
export function DogTraining({ bookingId, programs, chosen, bookingProgram, data }: {
  bookingId: string; programs: readonly string[]; chosen: string | null; bookingProgram: string | null;
  data: { program: string | null; paused: boolean; rows: Row[] } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const run = (fn: () => Promise<{ message: string }>) => start(async () => { const r = await fn(); setMsg(r.message); router.refresh(); });
  const rows = data?.rows || [];
  const sent = rows.filter((r) => r.status === "sent").length, during = rows.filter((r) => r.phase === "during");
  const next = rows.find((r) => r.status === "planned");
  return (
    <section id="program" className="panel scroll-mt-20 space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lead font-extrabold">Training materials</h2>
        <Link prefetch={false} href={`/a/materials${data?.program ? `?plan=${encodeURIComponent(data.program)}` : ""}`} className="text-small font-semibold underline">Edit the lists</Link>
      </div>
      <label className="block"><span className="label">Program</span>
        <select value={chosen || ""} disabled={pending} onChange={(e) => run(() => setProgramChoiceAction(bookingId, e.target.value))} className="field">
          <option value="">{bookingProgram ? `From the booking: ${bookingProgram}` : "Not clear from the booking: pick one"}</option>
          {programs.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      {!data?.program && <p className="rounded-xl bg-biscuit-wash px-3 py-2 text-small text-warn">Pick the program so this dog gets its training materials (it&apos;s also what the certificate says).</p>}
      {data && rows.length > 0 && (
        <>
          <p className="text-body">{sent} of {rows.length} sent{next?.on ? ` · next: ${next.title}, ${day(next.on)}` : ""}{data.paused ? " · paused" : ""}</p>
          <ol className="divide-y divide-line rounded-xl border border-line">
            {rows.map((r, i) => (
              <li key={i} className={`flex items-center gap-2.5 px-3 py-2 text-small ${r.status === "skipped" ? "text-ink-faint line-through" : ""}`}>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-paper">{r.status === "sent" ? <Check size={14} className="text-fern" /> : r.kind === "video" ? <Play size={12} /> : <FileText size={12} />}</span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="shrink-0 text-ink-soft">{r.phase === "after" && i === during.length ? "After: " : ""}{r.on ? day(r.on) : "skipped"}</span>
              </li>
            ))}
          </ol>
          <button type="button" disabled={pending} onClick={() => run(() => setTrainingPausedAction(bookingId, !data.paused))} className="btn-ghost">
            {data.paused ? <><Play size={16} />Resume</> : <><Pause size={16} />Pause for this dog</>}
          </button>
        </>
      )}
      {data?.program && rows.length === 0 && <p className="text-small text-ink-soft">Nothing on the {data.program} list yet.</p>}
      {msg && <p role="status" className="text-small font-semibold text-fern">{msg}</p>}
    </section>
  );
}
