"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { Check, Circle, CreditCard, FileText, Pencil, Upload } from "lucide-react";
import { Pill } from "@/components/ui";
import { addVaccineFileAction, reviewVaccinesAction, saveProfileAction, setClearedAction, setSlotAction } from "@/app/pretraining-actions";
import { uploadToDrive } from "@/lib/driveUpload";
import { driveView } from "@/lib/chatTypes";
import { Answers, INTAKE_QS, MANAGER_QS, Q, SECTIONS, Section, VACCINES, asked, blank, missingIn } from "@/lib/pretrainingFields";
import type { Profile } from "@/lib/pretraining";

type Role = "admin" | "trainer" | "client";
type Def = Profile["defs"][string] | undefined;

/** Options for a question: HubSpot's own (label + value) when we have them, otherwise the labels from the form. */
function optionsOf(q: Q, d: Def): { label: string; value: string }[] {
  if (d?.type === "bool") return [{ label: "Yes", value: "true" }, { label: "No", value: "false" }];
  if (d?.options?.length) return d.options;
  if (q.input === "yesno") return [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
  return (q.options || []).map((o) => ({ label: o, value: o }));
}
const isMulti = (q: Q, d: Def) => d?.fieldType === "checkbox" || (!d && q.input === "multi");
const isChoice = (q: Q, d: Def) => !!d?.options?.length || d?.type === "bool" || ["yesno", "select", "multi"].includes(q.input);
const isDate = (q: Q, d: Def) => d?.type === "date" || (!d && q.input === "date");
const asDate = (v: string) => (/^\d{10,}$/.test(v) ? new Date(Number(v)).toISOString().slice(0, 10) : v.slice(0, 10));
function shown(q: Q, d: Def, v: string) {
  if (blank(v)) return "";
  if (isDate(q, d)) { const x = asDate(v); return /^\d{4}-\d{2}-\d{2}$/.test(x) ? new Date(`${x}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : v; }
  if (!isChoice(q, d)) return v;
  const opts = optionsOf(q, d);
  return v.split(";").map((x) => opts.find((o) => o.value === x)?.label || x).join(", ");
}
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function DogProfile({ chatId, role, edit, open, profile, dogId, base }: { chatId: string; role: Role; edit: boolean; open: boolean; profile: Profile; dogId: string; base: string }) {
  const dog = profile.dogs.find((d) => d.booking.id === dogId) || profile.dogs[0];
  const many = profile.dogs.length > 1;
  const items = dog.ready.items.filter((i) => role !== "client" || i.who === "client");
  const left = dog.cleared ? [] : items.filter((i) => !i.done);
  const answersFor = (s: Section) => (s.scope === "client" ? profile.client : dog.answers);
  return (
    <div className="space-y-4">
      {many && (
        <nav className="flex flex-wrap gap-2" aria-label="Dogs">
          {profile.dogs.map((d) => (
            <Link key={d.booking.id} href={`${base}?dog=${d.booking.id}`} className={`rounded-full px-3.5 py-1.5 text-[14px] font-semibold ${d.booking.id === dog.booking.id ? "bg-ink text-white" : "border border-line bg-white"}`}>
              {d.name} {!d.ready.ready && <span className="ml-1 rounded-full bg-heart px-1.5 text-[11px] text-white">{d.ready.missing.filter((i) => role !== "client" || i.who === "client").length}</span>}
            </Link>
          ))}
        </nav>
      )}

      <section className={`panel p-4 ${left.length ? "" : "border-fern bg-mint-wash"}`} aria-labelledby="ready-title">
        <h2 id="ready-title" className="text-[18px] font-extrabold">{left.length ? `${left.length} thing${left.length > 1 ? "s" : ""} left before training` : `${dog.name} is ready for training`}</h2>
        {dog.cleared && role !== "client" && <p className="text-[13px] font-semibold text-fern">Marked OK to start by {dog.cleared.by}{dog.cleared.at ? `, ${when(dog.cleared.at)}` : ""}. The client isn&apos;t asked for anything more.</p>}
        <p className="mb-3 text-[13px] text-ink-soft">{dog.name} starts {new Date(`${dog.booking.start_date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}{role !== "client" && dog.booking.trainers?.name ? ` with ${dog.booking.trainers.name}` : ""}.</p>
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.key} className="flex items-start gap-2 text-[15px]">
              {i.done ? <Check size={18} className="mt-0.5 shrink-0 text-fern" aria-label="Done" /> : <Circle size={18} className={`mt-0.5 shrink-0 ${dog.cleared ? "text-ink-faint" : "text-heart"}`} aria-label={dog.cleared ? "Not needed" : "To do"} />}
              <span>{i.section && !i.done ? <a href={`#${i.section}`} className="font-semibold underline">{i.label}</a> : <span className={i.done ? "text-ink-soft" : "font-semibold"}>{i.label}</span>}{i.detail && <span className="text-ink-soft">: {i.detail}</span>}{role !== "client" && i.who === "admin" && <span className="text-[12px] text-ink-faint"> (team)</span>}</span>
            </li>
          ))}
        </ul>
        {profile.balanceLink && (role === "client"
          ? <a href={profile.balanceLink} target="_blank" rel="noopener" className="btn-ink mt-4 w-full"><CreditCard size={18} />Pay the remaining balance</a>
          : <p className="mt-3 text-[13px] text-ink-soft">Balance link: <a href={profile.balanceLink} target="_blank" rel="noopener" className="underline">open</a> (clears when the link is removed in HubSpot)</p>)}
        {role === "trainer" && dog.changedSinceStart && <p className="mt-3 rounded-xl bg-biscuit-wash p-2.5 text-[13px] font-semibold text-[#8A5A00]">The client changed some answers after pickup: look for &ldquo;updated&rdquo; below.</p>}
      </section>

      {role === "admin" && <AdminBits chatId={chatId} profile={profile} dog={dog} />}
      {role === "admin" && (dog.cleared || dog.ready.missing.length > 0) && <ClearButton chatId={chatId} bookingId={dog.booking.id} cleared={!!dog.cleared} />}

      <Vaccines chatId={chatId} role={role} edit={edit && open} dog={dog} dealYes={profile.deal.vaccines_in_order_} />

      {SECTIONS.map((s) => (
        <SectionCard key={s.id} chatId={chatId} bookingId={dog.booking.id} section={s} answers={answersFor(s)} defs={profile.defs} edit={edit && open} changes={dog.changes} shared={many && s.scope === "client"} role={role} />
      ))}
      {role === "client" && <p className="text-center text-[13px] text-ink-faint">Questions? Ask in the chat, or email info@dogwiseacademy.com.</p>}
    </div>
  );
}

function ClearButton({ chatId, bookingId, cleared }: { chatId: string; bookingId: string; cleared: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const click = () => {
    if (!cleared && !window.confirm("Mark this dog OK to start? The client won't be asked for anything more, and no \"Not ready\" incident will open. HubSpot isn't changed.")) return;
    start(async () => { const r = await setClearedAction(chatId, bookingId, !cleared); setMsg(r.message); router.refresh(); });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={cleared ? "btn-ghost" : "btn-ink"} disabled={pending} onClick={click}>{cleared ? "Undo OK to start" : "OK to start: stop asking the client"}</button>
      {msg && <span role="status" className="text-[13px] font-semibold">{msg}</span>}
    </div>
  );
}

function AdminBits({ chatId, profile, dog }: { chatId: string; profile: Profile; dog: Profile["dogs"][number] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const names = ["k9___dog_name", "dog_2_name", "dog_3_name", "dog_4_name"].map((k) => String(profile.deal[k] || ""));
  const contacts = String(profile.deal.__contacts || "").split(";").filter(Boolean);
  const all = { ...dog.answers, ...profile.client };
  const intakeLost = contacts.length <= 1 && MANAGER_QS().some((q) => !blank(dog.answers[q.key])) && INTAKE_QS().filter((q) => q.key !== "phone").every((q) => blank(all[q.key]));
  return (
    <section className="panel space-y-2 p-4 text-[13px] text-ink-soft">
      <p>
        {profile.syncedAt ? `From HubSpot, checked ${new Date(profile.syncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : "Not read from HubSpot yet."}
        {" "}<a className="underline" href={`https://app.hubspot.com/contacts/21869370/record/0-3/${profile.dealId}`} target="_blank" rel="noopener">Deal</a>
        {profile.contactId && <> · <a className="underline" href={`https://app.hubspot.com/contacts/21869370/record/0-1/${profile.contactId}`} target="_blank" rel="noopener">Contact</a></>}
      </p>
      {contacts.length > 1 && (
        <p className="font-semibold text-[#8A5A00]">This deal has {contacts.length} contacts in HubSpot ({contacts.map((id, i) => <span key={id}>{i ? ", " : ""}<a className="underline" href={`https://app.hubspot.com/contacts/21869370/record/0-1/${id}`} target="_blank" rel="noopener">{id}</a></span>)}). The app fills gaps from all of them, but please merge them in HubSpot.</p>
      )}
      {intakeLost && (
        <p className="font-semibold text-[#8A5A00]">The Client manager answers are here but none of the intake answers. The intake form was probably submitted without the client&apos;s email, so HubSpot made a second contact. Search HubSpot for {dog.booking.client_name} and merge that contact into this one: the answers then show here within 30 minutes.</p>
      )}
      {profile.syncError && <p className="font-semibold text-heart">{profile.syncError}{profile.pendingCount ? ` (${profile.pendingCount} answer${profile.pendingCount > 1 ? "s" : ""} waiting)` : ""}</p>}
      {profile.dogs.length > 1 && (
        <label className="flex flex-wrap items-center gap-2">
          <span>This booking is dog</span>
          <select className="field w-auto py-1.5" value={dog.slot} disabled={pending} onChange={(e) => start(async () => { const r = await setSlotAction(chatId, dog.booking.id, Number(e.target.value)); setMsg(r.ok ? "" : r.message); router.refresh(); })}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}{names[n - 1] ? `: ${names[n - 1]}` : ""}</option>)}
          </select>
          <span>on the deal{dog.slot === 1 ? " (answers saved on the HubSpot contact)" : " (answers kept in the app)"}{dog.slotSetBy ? `, set by ${dog.slotSetBy}` : ""}.</span>
          {msg && <span role="alert" className="text-heart">{msg}</span>}
        </label>
      )}
    </section>
  );
}

function Vaccines({ chatId, role, edit, dog, dealYes }: { chatId: string; role: Role; edit: boolean; dog: Profile["dogs"][number]; dealYes: string | null | undefined }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [miss, setMiss] = useState<string[]>(dog.vaccine.missing || []);
  const file = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    setMsg(""); setBusy("Uploading…");
    try {
      const r = await fetch("/api/pretraining/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, bookingId: dog.booking.id, name: f.name, type: f.type, size: f.size }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "Couldn't start the upload.");
      await uploadToDrive(f, d.uploadUrl, (sent) => setBusy(`Uploading… ${Math.round((sent / f.size) * 100)}%`), (note) => note && setBusy(note));
      setBusy("Finishing…");
      const a = await addVaccineFileAction(chatId, dog.booking.id, d.storedName, f.name);
      setMsg(a.message); router.refresh();
    } catch (e) { setMsg((e as Error).message); }
    setBusy("");
  };
  const review = (ok: boolean) => start(async () => { const r = await reviewVaccinesAction(chatId, dog.booking.id, ok, ok ? [] : miss); setMsg(r.message); router.refresh(); });
  return (
    <section id="vaccines" className="panel p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-extrabold">Vaccines</h2>
        <Pill tone={dog.vaccine.ok ? "mint" : "heart"}>{dog.vaccine.ok ? "Approved" : "Not approved yet"}</Pill>
      </div>
      <p className="text-[14px] text-ink-soft">{dog.vaccine.label}{dog.vaccines.reviewedBy && role === "admin" ? ` (checked by ${dog.vaccines.reviewedBy}${dog.vaccines.reviewedAt ? `, ${when(dog.vaccines.reviewedAt)}` : ""})` : ""}{dog.vaccine.ok && /^(yes|true)$/i.test(String(dealYes || "")) && !dog.vaccines.status && role === "admin" ? " (ticked in HubSpot)" : ""}</p>
      {dog.files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {dog.files.map((f) => (
            <li key={f.id}><a href={f.source === "hubspot" ? f.id : driveView(f.id)} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-[14px] font-semibold underline"><FileText size={15} />{f.name}</a>{f.at && <span className="text-[12px] text-ink-faint"> {when(f.at)}{role !== "client" ? `, ${f.by}` : ""}</span>}</li>
          ))}
        </ul>
      )}
      {edit && (
        <div className="mt-3">
          <input ref={file} type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => file.current?.click()}><Upload size={16} />{busy || (dog.files.length ? "Upload another record" : "Upload the vaccine record")}</button>
          {role === "client" && !dog.vaccine.ok && <p className="mt-1.5 text-[12px] text-ink-faint">A photo or PDF from your vet showing DHLPP, Bordetella and Rabies.</p>}
        </div>
      )}
      {role === "admin" && (
        <div className="mt-4 rounded-xl bg-paper p-3">
          <p className="mb-2 text-[13px] font-semibold">Check the records</p>
          <div className="mb-3 flex flex-wrap gap-3">
            {VACCINES.map((v) => (
              <label key={v} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" checked={miss.includes(v)} onChange={(e) => setMiss((m) => (e.target.checked ? [...m, v] : m.filter((x) => x !== v)))} />{v} missing</label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ink" disabled={pending} onClick={() => review(true)}>All OK</button>
            <button type="button" className="btn-ghost" disabled={pending || !miss.length} onClick={() => review(false)}>Save as missing</button>
          </div>
          <p className="mt-2 text-[12px] text-ink-faint">Updates &ldquo;Vaccines in order?&rdquo; and &ldquo;Missing vaccines&rdquo; on the HubSpot deal. A trainer allowing no rabies: just press All OK.</p>
        </div>
      )}
      {msg && <p role="status" className="mt-2 text-[13px] font-semibold">{msg}</p>}
    </section>
  );
}

function SectionCard({ chatId, bookingId, section, answers, defs, edit, changes, shared, role }: {
  chatId: string; bookingId: string; section: Section; answers: Answers; defs: Profile["defs"]; edit: boolean; changes: Profile["dogs"][number]["changes"]; shared: boolean; role: Role;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState<Answers>(answers);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const left = missingIn(section.questions, answers).length;
  const visible = useMemo(() => section.questions.filter((q) => asked(q, editing ? vals : answers)), [section, vals, answers, editing]);
  const set = (k: string, v: string) => setVals((cur) => ({ ...cur, [k]: v }));
  const save = () => start(async () => {
    const changed = Object.fromEntries(Object.entries(vals).filter(([k, v]) => (answers[k] || "") !== (v || "")));
    const r = Object.keys(changed).length ? await saveProfileAction(chatId, bookingId, changed) : { ok: true, message: "No changes." };
    setMsg(r.message);
    if (r.ok) { setEditing(false); router.refresh(); }
  });
  return (
    <section id={section.id} className="panel p-4" aria-labelledby={`${section.id}-title`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={`${section.id}-title`} className="text-[17px] font-extrabold">{section.title}{shared && <span className="ml-1.5 text-[12px] font-normal text-ink-faint">{role === "client" ? "(for all your dogs)" : "(same for every dog on the deal)"}</span>}</h2>
        <div className="flex items-center gap-2">
          {left > 0 && <Pill tone="heart">{left} to answer</Pill>}
          {edit && !editing && <button type="button" className="btn-ghost h-9 min-h-0 px-3 text-[13px]" onClick={() => { setVals(answers); setEditing(true); setMsg(""); }}><Pencil size={14} />{left ? "Answer" : "Edit"}</button>}
        </div>
      </div>
      {editing ? (
        <div className="space-y-4">
          {visible.map((q) => <Field key={q.key} q={q} d={defs[q.key]} value={vals[q.key] || ""} onChange={(v) => set(q.key, v)} />)}
          <div className="flex gap-2">
            <button type="button" className="btn-ink flex-1" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</button>
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => { setEditing(false); setMsg(""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <dl className="space-y-2.5">
          {visible.map((q) => {
            const v = shown(q, defs[q.key], answers[q.key] || ""), c = changes[q.key];
            return (
              <div key={q.key}>
                <dt className="text-[13px] text-ink-soft">{q.label}{q.required && !v && <span className="text-heart"> *</span>}</dt>
                <dd className={`whitespace-pre-wrap text-[15px] ${v ? "" : "text-ink-faint"}`}>{v || "Not answered"}{c && role !== "client" && <span className="ml-1.5 text-[11px] font-semibold text-[#8A5A00]">updated by {c.by}, {when(c.at)}</span>}</dd>
              </div>
            );
          })}
        </dl>
      )}
      {msg && <p role="status" className="mt-2 text-[13px] font-semibold">{msg}</p>}
    </section>
  );
}

function Field({ q, d, value, onChange }: { q: Q; d: Def; value: string; onChange: (v: string) => void }) {
  const id = `f-${q.key}`;
  if (q.key === "signature" && d?.type === "bool") q = { ...q, label: "I agree to the Terms & Conditions", input: "yesno" }; // HubSpot may store it as a tick box
  const label = <label htmlFor={id} className="label">{q.label}{q.required && <span className="text-heart"> *</span>}{q.hint && <span className="block text-[12px] font-normal text-ink-faint">{q.hint}</span>}</label>;
  if (isMulti(q, d)) {
    const chosen = value ? value.split(";").filter(Boolean) : [], max = q.key.startsWith("what_are_the_most_important") ? 4 : 99;
    return (
      <fieldset>
        <legend className="label">{q.label}{q.required && <span className="text-heart"> *</span>}</legend>
        <div className="flex flex-wrap gap-2">
          {optionsOf(q, d).map((o) => {
            const on = chosen.includes(o.value), full = !on && chosen.length >= max;
            return <label key={o.value} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[14px] ${on ? "border-ink bg-mint" : "border-line bg-white"} ${full ? "opacity-40" : ""}`}><input type="checkbox" className="sr-only" checked={on} disabled={full} onChange={() => onChange((on ? chosen.filter((x) => x !== o.value) : [...chosen, o.value]).join(";"))} />{o.label}</label>;
          })}
        </div>
        {max < 99 && <p className="mt-1 text-[12px] text-ink-faint">Pick up to {max}.</p>}
      </fieldset>
    );
  }
  if (isChoice(q, d)) {
    const opts = optionsOf(q, d);
    if (opts.length <= 4 && opts.every((o) => o.label.length < 40)) {
      return (
        <fieldset>
          <legend className="label">{q.label}{q.required && <span className="text-heart"> *</span>}</legend>
          <div className="flex flex-wrap gap-2">
            {opts.map((o) => <label key={o.value} className={`rounded-full border px-3.5 py-1.5 text-[14px] ${value === o.value ? "border-ink bg-mint font-semibold" : "border-line bg-white"}`}><input type="radio" className="sr-only" name={id} checked={value === o.value} onChange={() => onChange(o.value)} />{o.label}</label>)}
          </div>
        </fieldset>
      );
    }
    return <div>{label}<select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}><option value="">Choose…</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
  }
  if (isDate(q, d)) return <div>{label}<input id={id} type="date" className="field" value={asDate(value)} onChange={(e) => onChange(e.target.value)} /></div>;
  if (q.input === "textarea" || d?.fieldType === "textarea") return <div>{label}<textarea id={id} className="field min-h-[90px]" value={value} onChange={(e) => onChange(e.target.value)} /></div>;
  return <div>{label}<input id={id} type={d?.type === "number" ? "number" : "text"} className="field" value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}
