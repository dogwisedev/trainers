"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, FileText, Upload } from "lucide-react";
import { addFormVaccineAction, saveFormAction, setFormDogsAction } from "@/app/form-actions";
import { uploadToDrive } from "@/lib/driveUpload";
import { fileType, shrinkPhoto } from "@/lib/uploadPrep";
import { Field } from "@/components/DogProfile";
import type { Answers, Section } from "@/lib/pretrainingFields";
import type { ClientFormData } from "@/lib/clientForms";

const filled = (s: Section, a: Answers) => s.questions.filter((q) => q.required && !String(a[q.key] || "").trim()).length;

/** The client's before-training questions: their details once, then each dog's. Saves section by section. Mobile first. */
export function ClientForm({ token, f, sections }: { token: string; f: ClientFormData; sections: Section[] }) {
  const mine = sections.filter((s) => s.scope === "client"), dogs = sections.filter((s) => s.scope === "dog");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-h1 font-extrabold">Before training</h1>
        <p className="mt-1 text-body text-ink-soft">Hi {f.name.split(" ")[0]}! A few questions so your trainer knows your dog{f.dogs.length > 1 ? "s" : ""} from day one. It saves section by section, so you can stop and come back any time with this same link.</p>
        <p className="mt-2 rounded-xl bg-paper px-3 py-2 text-small text-ink-soft">We have you as <b className="break-all">{f.email || "no email yet"}</b>. Wrong? Tell the Dogwise team.</p>
      </div>
      <Group title="About you" note="Asked once, for all your dogs.">
        {mine.map((s) => <SectionForm key={s.id} token={token} dogKey={null} section={s} answers={f.client} defs={f.defs} />)}
      </Group>
      {f.dogs.length === 0 ? <DogNames token={token} current={[]} /> : <DogsRow token={token} f={f} />}
      {f.dogs.map((d) => (
        <Group key={d.key} title={`About ${d.name}`}>
          {dogs.map((s) => <SectionForm key={s.id} token={token} dogKey={d.key} section={s} answers={d.answers} defs={f.defs} />)}
          <Vaccines token={token} dog={d} />
        </Group>
      ))}

    </div>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div><h2 className="text-h3 font-extrabold">{title}</h2>{note && <p className="text-small text-ink-soft">{note}</p>}</div>
      {children}
    </section>
  );
}

function SectionForm({ token, dogKey, section, answers, defs }: { token: string; dogKey: string | null; section: Section; answers: Answers; defs: ClientFormData["defs"] }) {
  const router = useRouter();
  const [vals, setVals] = useState<Answers>(answers);
  const [open, setOpen] = useState(filled(section, answers) > 0);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const left = filled(section, vals);
  const save = () => start(async () => {
    const changed = Object.fromEntries(section.questions.map((q) => [q.key, String(vals[q.key] ?? "")]).filter(([k, v]) => v !== String(answers[k as string] ?? "")));
    const r = Object.keys(changed).length ? await saveFormAction(token, dogKey, changed) : { ok: true, message: "Saved." };
    setMsg(r);
    if (r.ok) { setOpen(left > 0); router.refresh(); }
  });
  return (
    <div className="panel overflow-hidden">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left">
        <span className="flex-1 font-bold">{section.title}</span>
        {left ? <span className="rounded-full bg-biscuit-wash px-2.5 py-0.5 text-small font-semibold text-warn">{left} left</span>
          : <span className="flex items-center gap-1 rounded-full bg-mint-wash px-2.5 py-0.5 text-small font-semibold text-fern"><Check size={14} />Done</span>}
        <ChevronDown size={18} className={`shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-line p-4">
          {section.questions.map((q) => (
            <Field key={q.key} q={q} d={defs[q.key]} idPrefix={`${dogKey || "you"}-${section.id}`.replace(/[^a-z0-9-]/gi, "_")} plain
              value={String(vals[q.key] ?? "")} onChange={(v) => setVals((x) => ({ ...x, [q.key]: v }))} />
          ))}
          <button type="button" onClick={save} disabled={pending} className="btn-ink w-full">{pending ? "Saving…" : "Save"}</button>
          {msg && <p role="status" className={`text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.message}</p>}
        </div>
      )}
    </div>
  );
}

/** "Your dogs: Spot, Tuffy · Change". From the booking they're fixed (the team changes them); otherwise the client can fix them. */
function DogsRow({ token, f }: { token: string; f: ClientFormData }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <DogNames token={token} current={f.dogs.map((d) => ({ key: d.key, name: d.name }))} onDone={() => setEditing(false)} />;
  return (
    <div className="panel flex flex-wrap items-center gap-2 p-4">
      <p className="min-w-0 flex-1 text-body"><span className="font-bold">Your dog{f.dogs.length > 1 ? "s" : ""}:</span> {f.dogs.map((d) => d.name).join(", ")}</p>
      {f.namesFrom === "deal"
        ? <p className="w-full text-small text-ink-soft">From your booking. A name wrong or a dog missing? Tell the Dogwise team.</p>
        : <button type="button" onClick={() => setEditing(true)} className="btn-ghost h-10 min-h-0 px-4">Change</button>}
    </div>
  );
}

function DogNames({ token, current, onDone }: { token: string; current: { key: string; name: string }[]; onDone?: () => void }) {
  const router = useRouter();
  const [n, setN] = useState(Math.max(1, current.length));
  const [names, setNames] = useState<string[]>([0, 1, 2, 3].map((i) => current[i]?.name || ""));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <section className="panel space-y-3 p-4">
      <h2 className="text-h3 font-extrabold">Your dogs</h2>
      <label className="block"><span className="label">How many dogs are coming to training?</span>
        <select value={n} onChange={(e) => setN(Number(e.target.value))} className="field">{[1, 2, 3, 4].map((x) => <option key={x} value={x}>{x}</option>)}</select>
      </label>
      {Array.from({ length: n }, (_, i) => (
        <label key={i} className="block"><span className="label">{n > 1 ? `Dog ${i + 1}'s name` : "Your dog's name"}</span>
          <input value={names[i]} onChange={(e) => setNames((x) => x.map((v, j) => (j === i ? e.target.value : v)))} className="field" maxLength={60} />
        </label>
      ))}
      <p className="text-caption text-ink-faint">Answers stay with each dog if you fix a name.</p>
      <div className="flex gap-2">
        <button type="button" disabled={pending} className="btn-ink flex-1" onClick={() => start(async () => {
          const list = names.slice(0, n).map((name, i) => ({ name, was: current[i]?.key || null }));
          const r = await setFormDogsAction(token, list); setMsg(r.ok ? "" : r.message); if (r.ok) { onDone?.(); router.refresh(); }
        })}>{pending ? "Saving…" : current.length ? "Save" : "Next"}</button>
        {onDone && <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>}
      </div>
      {msg && <p className="text-small text-heart">{msg}</p>}
    </section>
  );
}

/** Vaccine records for one dog: photos or PDFs, sent straight to the team (they check them). */
function Vaccines({ token, dog }: { token: string; dog: ClientFormData["dogs"][number] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const sent = dog.vaccines.length > 0 || dog.sentBefore;
  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    setMsg(null);
    for (const raw of [...files]) {
      try {
        const type = fileType(raw);
        if (!/^image\//.test(type) && type !== "application/pdf") { setMsg({ ok: false, message: "Send a photo or a PDF." }); continue; }
        const p = type.startsWith("image/") ? await shrinkPhoto(raw) : { blob: raw as Blob, name: raw.name, type };
        setBusy(`Sending ${p.name}…`);
        const r = await fetch("/api/forms/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, name: p.name, type: p.type, size: p.blob.size }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setMsg({ ok: false, message: d.message || "Couldn't start the upload." }); continue; }
        const id = await uploadToDrive(p.blob, d.uploadUrl, (n) => setBusy(`Sending ${p.name}… ${Math.round((n / p.blob.size) * 100)}%`), (note) => note && setBusy(note));
        const res = await addFormVaccineAction(token, dog.key, { id, storedName: d.storedName, folderId: d.folderId, name: p.name });
        setMsg(res);
      } catch (e) { setMsg({ ok: false, message: (e as Error).message }); }
    }
    setBusy(""); router.refresh();
  };
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center gap-3">
        <span className="flex-1 font-bold">Vaccine records</span>
        {sent ? <span className="flex items-center gap-1 rounded-full bg-mint-wash px-2.5 py-0.5 text-small font-semibold text-fern"><Check size={14} />Sent</span>
          : <span className="rounded-full bg-biscuit-wash px-2.5 py-0.5 text-small font-semibold text-warn">Needed</span>}
      </div>
      <p className="text-small text-ink-soft">A photo or PDF of {dog.name}&apos;s vaccine records (rabies, DHPP/DHLPP, Bordetella). The team checks them.</p>
      {dog.sentBefore && <p className="text-small text-ink-soft">Records sent earlier on our old form are already with the team.</p>}
      {dog.vaccines.length > 0 && <ul className="space-y-1">{dog.vaccines.map((v) => <li key={v.id} className="flex items-center gap-2 text-small"><FileText size={15} className="shrink-0 text-lav-deep" /><span className="truncate">{v.name}</span></li>)}</ul>}
      <label className={`btn-ghost w-full cursor-pointer justify-center ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <Upload size={17} />{busy || (sent ? "Add another" : "Add vaccine records")}
        <input type="file" accept="image/*,application/pdf,.heic,.pdf" multiple className="sr-only" onChange={(e) => { send(e.target.files); e.target.value = ""; }} />
      </label>
      {msg && <p role="status" className={`text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.message}</p>}
    </div>
  );
}
