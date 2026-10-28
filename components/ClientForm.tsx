"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { saveFormAction, setFormDogsAction } from "@/app/form-actions";
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
      {f.dogs.length === 0 ? <DogNames token={token} /> : f.dogs.map((d) => (
        <Group key={d.key} title={`About ${d.name}`}>
          {dogs.map((s) => <SectionForm key={s.id} token={token} dogKey={d.key} section={s} answers={d.answers} defs={f.defs} />)}
        </Group>
      ))}
      {f.dogs.length > 0 && f.namesFrom !== "deal" && <p className="text-center text-small text-ink-faint">Missing a dog, or a name spelled wrong? Tell the Dogwise team and it&apos;ll appear here.</p>}
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
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${left ? "bg-biscuit-wash text-warn" : "bg-mint-wash text-fern"}`}>{left ? <span className="text-caption font-bold">{left}</span> : <Check size={15} />}</span>
        <span className="flex-1 font-bold">{section.title}</span>
        <span className="text-small text-ink-soft">{left ? `${left} to answer` : "Done"}</span>
        <ChevronDown size={18} className={`shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-line p-4">
          {section.questions.map((q) => (
            <label key={q.key} className="block">
              <span className="label">{q.label}{q.required ? "" : " (optional)"}</span>
              <Field q={q} d={defs[q.key]} value={String(vals[q.key] ?? "")} onChange={(v) => setVals((x) => ({ ...x, [q.key]: v }))} />
            </label>
          ))}
          <button type="button" onClick={save} disabled={pending} className="btn-ink w-full">{pending ? "Saving…" : "Save"}</button>
          {msg && <p role="status" className={`text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.message}</p>}
        </div>
      )}
    </div>
  );
}

function DogNames({ token }: { token: string }) {
  const router = useRouter();
  const [n, setN] = useState(1);
  const [names, setNames] = useState<string[]>(["", "", "", ""]);
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
      <button type="button" disabled={pending} className="btn-ink w-full" onClick={() => start(async () => { const r = await setFormDogsAction(token, names.slice(0, n)); setMsg(r.ok ? "" : r.message); if (r.ok) router.refresh(); })}>{pending ? "Saving…" : "Next"}</button>
      {msg && <p className="text-small text-heart">{msg}</p>}
    </section>
  );
}
