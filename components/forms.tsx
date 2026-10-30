"use client";
import { useEffect, useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { addTimeOff, dealPrefillAction, deleteTimeOff, Result, saveBooking, saveTrainer, setExtraDays, setDisplayNameAction, setPassword, type DealPrefill } from "@/app/actions";
import { Trainer } from "@/lib/types";
import { cleanDealId } from "@/lib/dealId";

function Submit({ children, className = "btn-ink w-full" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending}>{pending ? "Saving…" : children}</button>;
}
function Note({ r }: { r: Result | null }) {
  if (!r) return null;
  return <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-body ${r.ok ? "bg-mint-wash text-fern" : "bg-heart-wash text-heart"}`}>{r.message}</p>;
}
const F = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block"><span className="label">{label}</span>{children}{hint && <span className="mt-1 block text-caption text-ink-faint">{hint}</span>}</label>
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
      {r && <span className={`mt-1 text-caption ${r.ok ? "text-fern" : "text-heart"}`}>{r.message}</span>}
    </span>
  );
}

export function DeleteTimeOff({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-caption text-heart">{msg}</span>}
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
            <label key={v} className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border text-body font-semibold ${scope === v ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>
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

/** Admin / sales: their own name (for the activity log). */
export function NameForm({ current }: { current: string }) {
  const [r, act] = useFormState(setDisplayNameAction, null);
  return (
    <form action={act} className="space-y-3">
      <F label="Your name" hint="Shown next to your email in the activity log. Clients still see “Dogwise team”."><input name="name" defaultValue={/^dogwise team$/i.test(current) ? "" : current} required minLength={2} maxLength={60} autoComplete="name" className="field" placeholder="First and last name" /></F>
      <Submit className="btn-ghost w-full">Save name</Submit>
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

type FieldDef = [key: keyof Trainer, label: string, type?: "text" | "textarea" | "number" | "date" | "email" | "tel" | "payroll"];
const CONTACT: FieldDef[] = [["phone", "Phone", "tel"], ["work_email", "Work email", "email"], ["address", "Address", "textarea"], ["second_location", "Second training location"]];
const CARE: FieldDef[] = [["local_vet", "Local vet", "textarea"], ["emergency_vet", "Emergency vet", "textarea"], ["emergency_contact", "Emergency contact", "textarea"]];
const ABOUT: FieldDef[] = [["bio", "Bio", "textarea"], ["birthday", "Birthday", "date"], ["shirt_size", "Hoodie / polo size"]];
const ADMIN: FieldDef[] = [["name", "Name"], ["email", "Email", "email"], ["dogwise_email", "Dogwise email", "email"], ["capacity", "Dogs at one time", "number"],
  ["monthly_capacity", "Average dogs per month", "number"], ["programs", "Programs", "textarea"], ["offering", "Offering", "textarea"], ["range_text", "Driving range (as they wrote it)"],
  ["range_miles", "Range used for matching (miles)", "number"], ["city", "City"], ["state", "State"], ["zip", "ZIP"], ["lat", "Latitude", "number"], ["lon", "Longitude", "number"],
  ["poc", "Point of contact (Dogwise)"], ["gusto_code", "Payroll number (from Gusto)", "payroll"], ["notes", "Admin notes", "textarea"]];

export function TrainerForm({ t, admin }: { t: Partial<Trainer>; admin: boolean }) {
  const [r, act] = useFormState(saveTrainer, null);
  const group = (title: string, defs: FieldDef[]) => (
    <fieldset className="panel p-4 md:p-5">
      <legend className="sr-only">{title}</legend>
      <h3 className="mb-4 text-lead font-bold">{title}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {defs.map(([k, label, type = "text"]) => {
          const v = t[k] as string | number | null | undefined;
          return (
            <F key={k} label={label}>
              {type === "payroll"
                ? <PayrollNumber name={k} value={(v ?? "") as string} />
                : type === "textarea"
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
/** Book a dog. Starts from the HubSpot deal (required): paste its link and the client, email, dogs and dates fill in. */
export function BookingForm({ trainers, defaultTrainer, defaultStart, defaultDeal }: { trainers: TrainerOption[]; defaultTrainer?: string; defaultStart?: string; defaultDeal?: string }) {
  const [r, act] = useFormState(saveBooking, null);
  const [tid, setTid] = useState(defaultTrainer || "");
  const [dealInput, setDealInput] = useState(defaultDeal || "");
  const [deal, setDeal] = useState<NonNullable<DealPrefill["deal"]> | null>(null);
  const [look, setLook] = useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: "", ok: true });
  const [client, setClient] = useState(""), [email, setEmail] = useState(""), [start, setStart] = useState(defaultStart || "");
  const [weeks, setWeeks] = useState("3"), [extra, setExtra] = useState("0");
  const [picked, setPicked] = useState<string[]>([]);
  const sel = trainers.find((t) => t.id === tid);
  const dealNo = ((c) => (c && /^\d+$/.test(c) ? c : ""))(cleanDealId(dealInput));

  const load = async (value: string) => {
    if (!value.trim()) return;
    setLook({ busy: true, msg: "", ok: true });
    const res = await dealPrefillAction(value);
    if (!res.ok || !res.deal) { setDeal(null); setLook({ busy: false, msg: res.message, ok: false }); return; }
    const d = res.deal;
    setDeal(d);
    if (d.client) setClient(d.client);
    if (d.email) setEmail(d.email);
    if (d.start) setStart(d.start);
    if (d.weeks) { setWeeks(String(d.weeks)); setExtra(String(d.extra)); }
    const bookedDogs = new Set(d.booked.map((b) => b.dog.toLowerCase()));
    setPicked(d.dogs.filter((x) => !bookedDogs.has(x.toLowerCase())));
    setLook({ busy: false, msg: res.message, ok: true });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (defaultDeal) load(defaultDeal); }, []);
  const notWon = !!deal && !deal.closedWon;

  return (
    <form action={act} className="space-y-4">
      <div className="rounded-2xl border border-line bg-canvas p-3.5">
        <F label="HubSpot deal" hint="Required. Paste the deal's link (or its number) and the rest fills in.">
          <span className="flex gap-2">
            <input name="hubspot_deal_id" required value={dealInput} onChange={(e) => { setDealInput(e.target.value); setDeal(null); }}
              onPaste={(e) => { const v = e.clipboardData.getData("text"); setTimeout(() => load(v), 0); }}
              className="field min-w-0 flex-1" placeholder="https://app.hubspot.com/contacts/…/record/0-3/…" autoComplete="off" />
            <button type="button" className="btn-ghost shrink-0" disabled={look.busy || !dealInput.trim()} onClick={() => load(dealInput)}>{look.busy ? "Loading…" : "Load"}</button>
          </span>
        </F>
        {look.msg && <p className={`mt-2 text-small ${look.ok ? "text-ink-soft" : "text-heart"}`}>{look.msg}</p>}
        {deal && (
          <div className="mt-3 rounded-xl bg-white p-3 text-body">
            <p className="font-bold">{deal.name}</p>
            <p className="text-small text-ink-soft">{deal.stage || "Stage unknown"}{deal.program ? ` · ${deal.program}` : ""}{deal.start ? ` · ${deal.start}${deal.end ? ` to ${deal.end}` : ""}` : ""}</p>
            {deal.program && <input type="hidden" name="program" value={deal.program} />}
            {notWon && <p className="mt-2 rounded-lg bg-heart-wash px-2.5 py-1.5 text-small text-heart">This deal isn&apos;t Closed Won in HubSpot. Mark it Closed Won first, then book it.</p>}
            {deal.booked.length > 0 && <p className="mt-2 rounded-lg bg-biscuit-wash px-2.5 py-1.5 text-small text-warn">Already booked on this deal: {deal.booked.map((b) => `${b.dog} with ${b.trainer} (${b.dates})`).join("; ")}.</p>}
          </div>
        )}
      </div>

      <F label="Trainer">
        <select name="trainer_id" required value={tid} onChange={(e) => setTid(e.target.value)} className="field">
          <option value="">Choose a trainer</option>
          {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}, {t.place}</option>)}
        </select>
      </F>
      {sel && <p className="-mt-2 rounded-xl bg-mint-wash px-3 py-2 text-small text-fern">{sel.free} kennel{sel.free === 1 ? "" : "s"} free this week. {sel.opening3 ? `3-week opening from ${sel.opening3}.` : "No 3-week opening in the next 16 weeks."}</p>}

      {deal && deal.dogs.length > 0 ? (
        <fieldset>
          <legend className="label">Dogs to book</legend>
          <div className="space-y-2">
            {deal.dogs.map((d) => {
              const done = deal.booked.some((b) => b.dog.toLowerCase() === d.toLowerCase());
              return (
                <label key={d} className={`flex min-h-[48px] items-center gap-3 rounded-xl border border-line bg-white px-3.5 text-body ${done ? "opacity-60" : ""}`}>
                  <input type="checkbox" name="dog" value={d} disabled={done} checked={picked.includes(d)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d] : p.filter((x) => x !== d)))} className="h-5 w-5 accent-[#281870]" />
                  <span className="flex-1 font-semibold">{d}</span>{done && <span className="text-small text-ink-soft">already booked</span>}
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-caption text-ink-faint">Each dog gets its own kennel, all in one chat with the client.</p>
        </fieldset>
      ) : (
        <F label="Dog"><input name="dog_name" required className="field" placeholder="Kya" /></F>
      )}

      <F label="Client"><input name="client_name" required value={client} onChange={(e) => setClient(e.target.value)} className="field" placeholder="Jessica M" /></F>
      <F label="Client's email" hint="Their chat link and reports go here."><input name="client_email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field" placeholder="jessica@example.com" /></F>
      <div className="grid grid-cols-2 gap-3">
        <F label="Pickup" hint="HubSpot's dates take over once it's saved."><input type="date" name="start_date" required value={start} onChange={(e) => setStart(e.target.value)} className="field" /></F>
        <F label="Program length">
          <select name="weeks" value={weeks} onChange={(e) => setWeeks(e.target.value)} className="field">{Array.from({ length: 12 }, (_, i) => i + 1).map((w) => <option key={w} value={w}>{w} week{w > 1 ? "s" : ""}</option>)}</select>
        </F>
      </div>
      <F label="Extra days after the last full week" hint="Paid at the weekly rate ÷ 7 per day.">
        <select name="extra_days" value={extra} onChange={(e) => setExtra(e.target.value)} className="field">{Array.from({ length: 14 }, (_, d) => d).map((d) => <option key={d} value={d}>{d ? `+ ${d} day${d > 1 ? "s" : ""}` : "None"}</option>)}</select>
      </F>
      <label className="flex min-h-[48px] items-center gap-3 rounded-xl border border-line bg-white px-3.5 text-body"><input type="checkbox" name="rehab" className="h-5 w-5 accent-[#281870]" />Rehab program (pays the rehab rate)</label>
      <F label="Status">
        <select name="status" defaultValue="confirmed" className="field"><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="in_training">In training</option></select>
      </F>
      <F label="Notes for the trainer"><textarea name="notes" rows={3} className="field" placeholder="Pickup Sunday 10am. Reactive to small dogs." /></F>
      <label className="flex min-h-[48px] items-center gap-3 rounded-xl border border-line bg-white px-3.5 text-small text-ink-soft"><input type="checkbox" name="force" className="h-5 w-5 accent-[#281870]" />Book anyway, even if the trainer has no free kennel</label>
      <BookSubmit disabled={!dealNo || notWon || (!!deal && deal.dogs.length > 0 && !picked.length)} />
      {!dealNo && <p className="text-caption text-ink-faint">Add the HubSpot deal to save.</p>}
      <Note r={r} />
    </form>
  );
}
function BookSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button className="btn-ink w-full" disabled={pending || disabled}>{pending ? "Booking…" : "Book"}</button>;
}

/** Change a booking's extra days (e.g. the dog stays 2 more days). */
export function ExtraDays({ id, current }: { id: string; current: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex items-center gap-1.5">
      <label className="sr-only" htmlFor={`xd-${id}`}>Extra days</label>
      <select id={`xd-${id}`} defaultValue={current} disabled={pending} className="h-9 rounded-lg border border-line bg-white px-2 text-small"
        onChange={(e) => start(async () => { const r = await setExtraDays(id, Number(e.target.value)); setMsg(r.ok ? "" : r.message); })}>
        {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d ? `+${d} day${d > 1 ? "s" : ""}` : "No extra days"}</option>)}
      </select>
      {msg && <span className="text-caption text-heart">{msg}</span>}
    </span>
  );
}

/** The trainer's Gusto payroll number: filled in from the Gusto file on payday, so read-only, with "Change" for the rare wrong match. */
function PayrollNumber({ name, value }: { name: string; value: string }) {
  const [edit, setEdit] = useState(false);
  return (
    <div>
      <div className="flex gap-2">
        <input name={name} defaultValue={value} readOnly={!edit} className={`field ${edit ? "" : "bg-canvas text-ink-soft"}`} placeholder="Added from the Gusto file on payday" />
        {!edit && <button type="button" className="btn-ghost h-[46px] min-h-0 shrink-0 px-3 text-small" onClick={() => setEdit(true)}>Change</button>}
      </div>
      <p className="mt-1 text-caption text-ink-faint">Nothing to fill in: it comes from Gusto&apos;s contractor pay file when payslips are done.</p>
    </div>
  );
}
