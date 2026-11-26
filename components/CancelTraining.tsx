"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelTrainingAction } from "@/app/actions";
import { finishEarlyAction } from "@/app/stay-actions";
import { CANCEL_REASONS } from "@/lib/cancelReasons";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Dog page: Cancel training. Before pickup it's a plain cancel. Once the training has started the same button asks
 *  "Is this a mid-training cancel?": yes = cancelled (HubSpot and the refund question for Sean, as before), no = the dog
 *  finished early (nothing to HubSpot's status, nothing for Sean). Either way the admin says when the dog left and whether
 *  the trainer is paid for the days with them, and the payslip follows (migration 070). */
export function CancelTraining({ bookingId, dog, trainer, started = false, start: startDate = "", end = "", today = "" }: { bookingId: string; dog: string; trainer: string; started?: boolean; start?: string; end?: string; today?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"" | "cancel" | "early">(started ? "" : "cancel");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [leftOn, setLeftOn] = useState(today && today < end ? today : "");
  const [pay, setPay] = useState<"" | "days" | "none">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const first = trainer.split(" ")[0];
  const needNote = kind === "cancel" && reason === "Other" && !note.trim();
  const days = leftOn && startDate && leftOn >= startDate ? between(startDate, leftOn) : null;
  const ready = kind === "cancel" ? !!reason && !needNote && (!started || (!!leftOn && !!pay)) : kind === "early" ? !!leftOn && !!pay : false;
  const close = () => { setOpen(false); setKind(started ? "" : "cancel"); };
  const go = () => start(async () => {
    const r = kind === "early" ? await finishEarlyAction(bookingId, leftOn, pay as "days" | "none", note)
      : await cancelTrainingAction(bookingId, reason, note, started ? { leftOn, pay: pay as "days" | "none" } : undefined);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { close(); router.refresh(); }
  });
  if (!open) return (
    <span className="inline-flex flex-col">
      <button type="button" className="btn-danger" onClick={() => { setOpen(true); setMsg(null); }}>Cancel training</button>
      {msg && <span className={`mt-1 max-w-md text-caption ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</span>}
    </span>
  );
  const payQuestion = (
    <>
      <label className="mt-3 block"><span className="label">Which day did {dog} leave {first}?</span>
        <input type="date" className="field" value={leftOn} min={startDate || undefined} max={kind === "early" && end ? new Date(Date.parse(`${end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : today || undefined} onChange={(e) => setLeftOn(e.target.value)} />
      </label>
      <fieldset className="mt-3"><legend className="label">Pay for the days with {first}</legend>
        <label className="mt-1 flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-white px-3 text-body"><input type="radio" name={`pay-${bookingId}`} className="h-5 w-5" checked={pay === "days"} onChange={() => setPay("days")} />
          <span>Pay {first} for {days != null ? `the ${days} day${days === 1 ? "" : "s"}` : "the days"} {dog} was with them{leftOn && startDate ? ` (${day(startDate)} to ${day(leftOn)})` : ""}</span></label>
        <label className="mt-1.5 flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-white px-3 text-body"><input type="radio" name={`pay-${bookingId}`} className="h-5 w-5" checked={pay === "none"} onChange={() => setPay("none")} />
          <span>No payment for the days with {first}</span></label>
      </fieldset>
      <p className="mt-2 text-small text-ink-soft">This goes on {first}&apos;s payslip for those dates by itself. Payslips already approved stay as they are.</p>
    </>
  );
  return (
    <div className="w-full rounded-2xl border border-heart/30 bg-heart-wash p-4">
      {kind === "" && (
        <>
          <p className="text-lead font-bold text-heart">{dog}&apos;s training has started. Is this a mid-training cancel?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-danger" onClick={() => setKind("cancel")}>Yes, it&apos;s cancelled</button>
            <button type="button" className="btn-ghost" onClick={() => setKind("early")}>No, {dog} finished early</button>
            <button type="button" className="btn-ghost" onClick={close}>Keep it</button>
          </div>
          <p className="mt-2 text-small text-ink-soft">Cancelled: HubSpot is marked Cancelled and the client&apos;s refund goes to Sean. Finished early: the program just ends sooner, and nobody is asked about a refund.</p>
        </>
      )}
      {kind === "cancel" && (
        <>
          <p className="text-lead font-bold text-heart">Cancel {dog}&apos;s training{started ? " mid-program" : ""}?</p>
          <p className="mt-1 text-body">{trainer} gets a cancellation with a calendar removal, HubSpot is marked Cancelled, and {started ? "the client's refund goes to Sean" : "the office is told to sort the refund"}. The kennel frees up straight away.</p>
          <p className="mt-1 text-body font-semibold">Only use it for a training that was really cancelled.</p>
          <label className="mt-3 block"><span className="label">Why was it cancelled?</span>
            <select className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Pick one…</option>
              {CANCEL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {started && payQuestion}
          <label className="mt-3 block"><span className="label">More detail{reason === "Other" ? "" : " (optional)"}</span>
            <textarea className="field min-h-[72px]" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Moving house, will rebook in spring" />
          </label>
          <p className="mt-2 text-small text-ink-soft">The reason goes to the office and stays on the booking. It isn&apos;t in the trainer&apos;s email.</p>
        </>
      )}
      {kind === "early" && (
        <>
          <p className="text-lead font-bold text-ink">{dog} finished early</p>
          <p className="mt-1 text-body">The program ends on the day {dog} left: the new end date goes to HubSpot, {first}&apos;s calendar is updated and the kennel frees up from then. It is not a cancellation.</p>
          {payQuestion}
          <label className="mt-3 block"><span className="label">Note (optional)</span>
            <textarea className="field min-h-[60px]" value={note} maxLength={900} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Owner back from travel a week early" />
          </label>
        </>
      )}
      {msg && !msg.ok && <p role="alert" className="mt-2 text-small font-semibold text-heart">{msg.text}</p>}
      {kind !== "" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={kind === "early" ? "btn-ink" : "btn-danger"} disabled={pending || !ready} onClick={go}>{pending ? "Saving…" : kind === "early" ? "End the program here" : "Cancel the training"}</button>
          {started && <button type="button" className="btn-ghost" disabled={pending} onClick={() => setKind("")}>Back</button>}
          <button type="button" className="btn-ghost" disabled={pending} onClick={close}>Keep it</button>
        </div>
      )}
    </div>
  );
}
