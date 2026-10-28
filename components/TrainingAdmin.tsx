"use client";
import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ExternalLink, FileText, Play, Trash2 } from "lucide-react";
import { addMaterialAction, importFolderAction, moveMaterialAction, removeMaterialAction, saveIntroAction, saveMaterialAction, savePlanAction, setSendingPausedAction } from "@/app/training-actions";
import { driveView } from "@/lib/chatTypes";

type Item = { id: string; position: number; title: string; message: string | null; drive_id: string; kind: "video" | "file" | "photo" };
type Settings = { plan: string; first_day: number; start_after: number; every_days: number };
type R = { ok: boolean; message: string } | null;

function Save({ label = "Save", className = "btn-ghost" }: { label?: string; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending}>{pending ? "Saving…" : label}</button>;
}
const Note = ({ r }: { r: R }) => (r?.message ? <p role="status" className={`text-small font-semibold ${r.ok ? "text-fern" : "text-heart"}`}>{r.message}</p> : null);

export function TrainingAdmin({ plan, plans, items, settings, intro }: { plan: string; plans: { value: string; label: string }[]; items: Item[]; settings: Settings; intro: string }) {
  const router = useRouter();
  const after = plan === "after";
  return (
    <div className="space-y-4">
      <label className="block"><span className="label">Program</span>
        <select value={plan} onChange={(e) => router.push(`/a/materials?plan=${encodeURIComponent(e.target.value)}`)} className="field">
          {plans.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      <Pace plan={plan} s={settings} after={after} count={items.length} />
      <section className="space-y-3" aria-label="Items">
        {items.length === 0 && <p className="panel p-4 text-body text-ink-soft">Nothing on this list yet. Add an item or import a folder below.</p>}
        {items.map((it, i) => <ItemCard key={it.id} it={it} n={i + 1} first={i === 0} last={i === items.length - 1} after={after} settings={settings} />)}
      </section>
      <AddItem plan={plan} />
      <ImportFolder plan={plan} />
      <Intro intro={intro} />
    </div>
  );
}

function Pace({ plan, s, after, count }: { plan: string; s: Settings; after: boolean; count: number }) {
  const [r, act] = useFormState(savePlanAction, null);
  return (
    <form action={act} className="panel space-y-3 p-4">
      <input type="hidden" name="plan" value={plan} />
      <p className="font-bold">When they go out</p>
      {after ? (
        <div className="flex flex-wrap items-center gap-2 text-body">
          Item 1 goes <input name="start_after" type="number" min={0} max={60} defaultValue={s.start_after} className="field w-20 text-center" /> days after drop-off, then one every
          <input name="every_days" type="number" min={1} max={60} defaultValue={s.every_days} className="field w-20 text-center" /> days.
          <input type="hidden" name="first_day" value={s.first_day} />
        </div>
      ) : (
        <div className="space-y-2 text-body">
          <div className="flex flex-wrap items-center gap-2">Item 1 goes on day <input name="first_day" type="number" min={1} max={60} defaultValue={s.first_day} className="field w-20 text-center" /> (day 1 is pickup).</div>
          <p className="text-small text-ink-soft">The rest follow in this order, spread evenly up to the day before drop-off, at most one a day. If a dog&apos;s program is too short for {count || "all the"} items, the last ones are skipped.</p>
          <input type="hidden" name="start_after" value={s.start_after} /><input type="hidden" name="every_days" value={s.every_days} />
        </div>
      )}
      <div className="flex items-center gap-3"><Save /><Note r={r} /></div>
    </form>
  );
}

function ItemCard({ it, n, first, last, after, settings }: { it: Item; n: number; first: boolean; last: boolean; after: boolean; settings: Settings }) {
  const router = useRouter();
  const [r, act] = useFormState(saveMaterialAction, null);
  const [pending, start] = useTransition();
  const when = after ? `Day ${settings.start_after + (n - 1) * settings.every_days} after drop-off` : n === 1 ? `Day ${settings.first_day}` : "Spread over the program";
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  return (
    <form action={act} className="panel space-y-2.5 p-4">
      <input type="hidden" name="id" value={it.id} />
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-small font-bold text-white">{n}</span>
        <span className="flex-1 text-small font-semibold text-ink-soft">{when}</span>
        <button type="button" disabled={first || pending} onClick={() => run(() => moveMaterialAction(it.id, "up"))} className="grid h-10 w-10 place-items-center rounded-full border border-line disabled:opacity-30" aria-label="Move up"><ArrowUp size={17} /></button>
        <button type="button" disabled={last || pending} onClick={() => run(() => moveMaterialAction(it.id, "down"))} className="grid h-10 w-10 place-items-center rounded-full border border-line disabled:opacity-30" aria-label="Move down"><ArrowDown size={17} /></button>
      </div>
      <label className="block"><span className="label">Title</span><input name="title" defaultValue={it.title} required maxLength={140} className="field" /></label>
      <label className="block"><span className="label">Message sent with it</span>
        <textarea name="message" defaultValue={it.message || ""} rows={2} maxLength={1000} className="field" placeholder="Here's a short helper on how to handle leash reactivity." />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Save />
        <a href={driveView(it.drive_id)} target="_blank" rel="noopener" className="btn-ghost">{it.kind === "video" ? <Play size={16} /> : <FileText size={16} />}Open<ExternalLink size={14} /></a>
        <button type="button" disabled={pending} onClick={() => { if (window.confirm(`Take "${it.title}" off this list? Dogs that already got it keep it in their chat.`)) run(() => removeMaterialAction(it.id)); }} className="btn-ghost ml-auto text-heart"><Trash2 size={16} />Remove</button>
      </div>
      {!it.message && <p className="text-caption text-warn">No message yet: only the title is posted.</p>}
      <Note r={r} />
    </form>
  );
}

function AddItem({ plan }: { plan: string }) {
  const [r, act] = useFormState(addMaterialAction, null);
  return (
    <form action={act} key={r?.ok ? r.message : "add"} className="panel space-y-3 border-lav/50 p-4">
      <input type="hidden" name="plan" value={plan} />
      <p className="font-bold">+ Add training material</p>
      <label className="block"><span className="label">Google Drive link (video or PDF)</span><input name="link" required className="field" placeholder="https://drive.google.com/file/d/…/view" autoComplete="off" /></label>
      <label className="block"><span className="label">Title (optional: the file name is used if empty)</span><input name="title" maxLength={140} className="field" /></label>
      <label className="block"><span className="label">Message sent with it</span><textarea name="message" rows={2} maxLength={1000} className="field" placeholder="Here's a short helper on…" /></label>
      <p className="text-caption text-ink-faint">The file must be shared as &quot;Anyone with the link can view&quot;. The app checks it when you add it.</p>
      <div className="flex items-center gap-3"><Save label="Add to the list" className="btn-ink" /><Note r={r} /></div>
    </form>
  );
}

function ImportFolder({ plan }: { plan: string }) {
  const [r, act] = useFormState(importFolderAction, null);
  return (
    <form action={act} className="panel space-y-3 p-4">
      <input type="hidden" name="plan" value={plan} />
      <p className="font-bold">Import a folder</p>
      <label className="block"><span className="label">Google Drive folder link</span><input name="folder" required className="field" placeholder="https://drive.google.com/drive/folders/…" autoComplete="off" /></label>
      <p className="text-caption text-ink-faint">Adds every video and PDF in it to the end of this list, in name order (1, 2 … 10). Ones already on the list are left out.</p>
      <div className="flex items-center gap-3"><Save label="Import" /><Note r={r} /></div>
    </form>
  );
}

function Intro({ intro }: { intro: string }) {
  const [r, act] = useFormState(saveIntroAction, null);
  const [v, setV] = useState(intro);
  return (
    <form action={act} className="panel space-y-3 p-4">
      <p className="font-bold">Intro (all programs)</p>
      <p className="text-small text-ink-soft">Goes above the message of the first item each client gets, once.</p>
      <textarea name="intro" value={v} onChange={(e) => setV(e.target.value)} rows={3} maxLength={600} className="field" />
      <div className="flex items-center gap-3"><Save /><Note r={r} /></div>
    </form>
  );
}

/** Stop or restart all sending, at the top of the page. */
export function SendingSwitch({ paused, byEnv }: { paused: boolean; byEnv: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${paused ? "border-heart/40 bg-heart-wash" : "border-line bg-white"}`}>
      <p className="min-w-0 flex-1 text-body"><b>{paused ? "Sending is paused." : "Sending is on."}</b> {paused ? (byEnv ? "TRAINING_MATERIALS=off is set in Vercel: remove it and redeploy to restart." : "Nothing goes out until you restart it.") : "Items go out between 12 and 6 PM Eastern."}</p>
      {!byEnv && <button type="button" disabled={pending} onClick={() => start(async () => { const r = await setSendingPausedAction(!paused); setMsg(r.message); router.refresh(); })} className={paused ? "btn-ink" : "btn-ghost"}>{pending ? "…" : paused ? "Restart sending" : "Pause sending"}</button>}
      {msg && <p role="status" className="w-full text-small text-ink-soft">{msg}</p>}
    </div>
  );
}
