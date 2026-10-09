"use client";
import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { addTimeOff, deleteTimeOff, Result, saveBooking, saveTrainer, setExtraDays, setPassword } from "@/app/actions";
import { Trainer } from "@/lib/types";

function Submit({ children, className = "btn-ink w-full" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending}>{pending ? "Saving…" : children}</button>;
}
function Note({ r }: { r: Result | null }) {
  if (!r) return null;
  return <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-[14px] ${r.ok ? "bg-mint-wash text-fern" : "bg-heart-wash text-heart"}`}>{r.message}</p>;
}
const F = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block"><span className="label">{label}</span>{children}{hint && <span className="mt-1 block text-[12px] text-ink-faint">{hint}</span>}</label>
);

/** Runs a server action from a button and shows the result inline. */
export function ActionButton({ action, children, className = "btn-ghost", confirm }: { action: () => Promise<Result>; children: React.ReactNode; className?: string; confirm?: string }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<Result | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button type="button" className={className} disabled={pending}
        onClick={() => { if (confirm && !window.confirm(confirm)) return; start(async () => setR(await action())); }}>
        {pending ? "Working…" : children}
      </button>
      {r && <span className={`mt-1 text-[12px] ${r.ok ? "text-fern" : "text-heart"}`}>{r.message}</span>}
    </span>
  );
}

export function DeleteTimeOff({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-[12px] text-heart">{msg}</span>}
      <button type="button" aria-label="Remove time off" disabled={pending} className="grid h-10 w-10 place-items-center rounded-full text-ink-faint hover:bg-heart-wash hover:text-heart"
        onClick={() => start(async () => { const r = await deleteTimeOff(id); if (!r.ok) setMsg(r.message); })}>
        <Trash2 size={17} />
      </button>
    </span>
  );
}

export function TimeOffForm({ trainerId, capacity }: { trainerId: string; capacity: number }) {
  const [r, act] = useFormState(addTimeOff, null);
  const [scope, setScope] = useState("all");
  return (
    <form action={act} className="space-y-4">
      <input type="hidden" name="trainer_id" value={trainerId} />
      <div className="grid grid-cols-2 gap-3">
        <F label="From"><input type="date" name="start_date" required className="field" /></F>
        <F label="To"><input type="date" name="end_date" required className="field" /></F>
      </div>
      <F label="Reason">
        <select name="reason" className="field" defaultValue="Holiday">
          <option>Holiday</option><option>Illness</option><option>Personal</option><option>Training event</option><option>Other</option>
        </select>
      </F>
      <fieldset>
        <legend className="label">What&apos;s blocked</legend>
        <div className="grid grid-cols-2 gap-2">
          {[["all", "Whole calendar"], ["some", "Some kennels"]].map(([v, l]) => (
            <label key={v} className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border text-[14px] font-semibold ${scope === v ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>
              <input type="radio" name="scope" value={v} checked={scope === v} onChange={() => setScope(v)} className="sr-only" />{l}
            </label>
          ))}
        </div>
      </fieldset>
      {scope === "some" && (
        <F label="Kennels blocked" hint={`You normally take ${capacity}.`}>
          <input type="number" name="slots_blocked" min={1} max={Math.max(1, capacity - 1)} defaultValue={1} className="field" />
        </F>
      )}
      <F label="Note (optional)"><input name="note" className="field" placeholder="e.g. No pickups that weekend" /></F>
      <Submit>Block these dates</Submit>
      <Note r={r} />
    </form>
  );
}

export function PasswordForm() {
  const [r, act] = useFormState(setPassword, null);
  return (
    <form action={act} className="space-y-3">
      <F label="New password"><input type="password" name="password" minLength={8} autoComplete="new-password" className="field" /></F>
      <Submit className="btn-ghost w-full">Save password</Submit>
      <Note r={r} />
    </form>
  );
}

type FieldDef = [key: keyof Trainer, label: string, type?: "text" | "textarea" | "number" | "date" | "email" | "tel"];
const CONTACT: FieldDef[] = [["phone", "Phone", "tel"], ["work_email", "Work email", "email"], ["address", "Address", "textarea"], ["second_location", "Second training location"]];
const CARE: FieldDef[] = [["local_vet", "Local vet", "textarea"], ["emergency_vet", "Emergency vet", "textarea"], ["emergency_contact", "Emergency contact", "textarea"]];
const ABOUT: FieldDef[] = [["bio", "Bio", "textarea"], ["birthday", "Birthday", "date"], ["shirt_size", "Hoodie / polo size"]];
const ADMIN: FieldDef[] = [["name", "Name"], ["email", "Email", "email"], ["dogwise_email", "Dogwise email", "email"], ["capacity", "Dogs at one time", "number"],
  ["monthly_capacity", "Average dogs per month", "number"], ["programs", "Programs", "textarea"], ["offering", "Offering", "textarea"], ["range_text", "Driving range (as they wrote it)"],
  ["range_miles", "Range used for matching (miles)", "number"], ["city", "City"], ["state", "State"], ["zip", "ZIP"], ["lat", "Latitude", "number"], ["lon", "Longitude", "number"],
  ["poc", "Point of contact (Dogwise)"], ["notes", "Admin notes", "textarea"]];

export function TrainerForm({ t, admin }: { t: Partial<Trainer>; admin: boolean }) {
  const [r, act] = useFormState(saveTrainer, null);
  const group = (title: string, defs: FieldDef[]) => (
    <fieldset className="panel p-4 md:p-5">
      <legend className="sr-only">{title}</legend>
      <h3 className="mb-4 text-[16px] font-bold">{title}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {defs.map(([k, label, type = "text"]) => {
          const v = t[k] as string | number | null | undefined;
          return (
            <F key={k} label={label}>
              {type === "textarea"
                ? <textarea name={k} defaultValue={(v ?? "") as string} rows={2} className="field" />
                : <input name={k} type={type} step={type === "number" ? "any" : undefined} defaultValue={(v ?? "") as string} className="field" required={k === "name"} />}
            </F>
          );
        })}
      </div>
    </fieldset>
  );
  return (
    <form action={act} className="space-y-4">
      {t.id && <input type="hidden" name="id" value={t.id} />}
      {admin && group("Dogwise details", ADMIN)}
      {group("Contact", CONTACT)}
      {group("Vets and emergencies", CARE)}
      {group("About", ABOUT)}
      <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-4"><Submit>{t.id ? "Save profile" : "Add trainer"}</Submit></div>
      <Note r={r} />
    </form>
  );
}

export type TrainerOption = { id: string; name: string; place: string; free: number; opening3: string | null };
export function BookingForm({ trainers, defaultTrainer, defaultStart }: { trainers: TrainerOption[]; defaultTrainer?: string; defaultStart?: string }) {
  const [r, act] = useFormState(saveBooking, null);
  const [tid, setTid] = useState(defaultTrainer || "");
  const sel = trainers.find((t) => t.id === tid);
  return (
    <form action={act} className="space-y-4">
      <F label="Trainer">
        <select name="trainer_id" required value={tid} onChange={(e) => setTid(e.target.value)} className="field">
          <option value="">Choose a trainer</option>
          {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}, {t.place}</option>)}
        </select>
      </F>
      {sel && <p className="-mt-2 rounded-xl bg-mint-wash px-3 py-2 text-[13px] text-fern">{sel.free} kennels free this week. {sel.opening3 ? `3-week opening from ${sel.opening3}.` : "No 3-week opening in the next 16 weeks."}</p>}
      <div className="grid grid-cols-2 gap-3">
        <F label="Client"><input name="client_name" required className="field" placeholder="Jessica M" /></F>
        <F label="Dog"><input name="dog_name" className="field" placeholder="Kya" /></F>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <F label="Start" hint="Rounded to that week's Sunday"><input type="date" name="start_date" required defaultValue={defaultStart} className="field" /></F>
        <F label="Program length">
          <select name="weeks" defaultValue="3" className="field">{[1, 2, 3, 4, 5, 6, 7, 8].map((w) => <option key={w} value={w}>{w} week{w > 1 ? "s" : ""}</option>)}</select>
        </F>
      </div>
      <F label="Extra days after the last full week" hint="Paid at the weekly rate ÷ 7 per day.">
        <select name="extra_days" defaultValue="0" className="field">{[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d ? `+ ${d} day${d > 1 ? "s" : ""}` : "None"}</option>)}</select>
      </F>
      <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-line bg-white px-3.5 text-[15px]"><input type="checkbox" name="rehab" className="h-5 w-5 accent-[#1D3557]" />Rehab program (pays the rehab rate)</label>
      <F label="Status">
        <select name="status" defaultValue="confirmed" className="field"><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="in_training">In training</option></select>
      </F>
      <F label="HubSpot deal ID (optional)"><input name="hubspot_deal_id" className="field" inputMode="numeric" /></F>
      <F label="Notes for the trainer"><textarea name="notes" rows={3} className="field" placeholder="Pickup Sunday 10am. Reactive to small dogs." /></F>
      <Submit>Save booking</Submit>
      <Note r={r} />
    </form>
  );
}

/** Change a booking's extra days (e.g. the dog stays 2 more days). */
export function ExtraDays({ id, current }: { id: string; current: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex items-center gap-1.5">
      <label className="sr-only" htmlFor={`xd-${id}`}>Extra days</label>
      <select id={`xd-${id}`} defaultValue={current} disabled={pending} className="h-9 rounded-lg border border-line bg-white px-2 text-[13px]"
        onChange={(e) => start(async () => { const r = await setExtraDays(id, Number(e.target.value)); setMsg(r.ok ? "" : r.message); })}>
        {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d ? `+${d} day${d > 1 ? "s" : ""}` : "No extra days"}</option>)}
      </select>
      {msg && <span className="text-[12px] text-heart">{msg}</span>}
    </span>
  );
}
