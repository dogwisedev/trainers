"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { approveReportAction, resendReportAction, saveReportAction, sendBackAction, submitReportAction, ReportResult } from "@/app/report-actions";
import { MediaPicker } from "@/components/MediaPicker";
import { Answers, Field, HANDOVER_AFTER, HANDOVER_SIMPLE, INTAKE_SECTIONS, Item, Kind, MediaItem, Status, WEEKLY_SECTIONS, arr, deadlineHint, raw, rawItems, s, validate } from "@/lib/reports";
import { buildReport, reportHtml } from "@/lib/reportDoc";

type Props = {
  id: string; kind: Kind; mode: "trainer" | "admin"; status: Status; bookingId: string;
  initialAnswers: Answers; initialMedia: MediaItem[]; startDate: string; endDate: string; submittedAt: string | null;
  reviewNote: string | null; due: string | null; late: number; demo: boolean; chatId: string | null;
  meta: { approvedBy: string | null; approvedAt: string | null; sentTo: string | null; sentAt: string | null; error: string | null; byAdmin: boolean };
};

function Chips({ name, options, value, multi, onChange }: { name: string; options: string[]; value: string[]; multi: boolean; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role={multi ? "group" : "radiogroup"}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <label key={o} className={`inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-4 text-[14px] font-semibold focus-within:ring-2 focus-within:ring-ink focus-within:ring-offset-2 ${on ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>
            <input type={multi ? "checkbox" : "radio"} name={name} className="sr-only" checked={on} onChange={() => onChange(multi ? (on ? value.filter((x) => x !== o) : [...value, o]) : [o])} />{o}
          </label>
        );
      })}
    </div>
  );
}

function ItemList({ title, value, onChange, hint }: { title: string; value: Item[]; onChange: (v: Item[]) => void; hint: string }) {
  const list = value.length ? value : [{ title: "", text: "" }];
  const set = (i: number, p: Partial<Item>) => onChange(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="space-y-3">
      {list.map((it, i) => (
        <div key={i} className="rounded-2xl border border-line bg-white p-3">
          <div className="flex items-center justify-between"><span className="text-[13px] font-bold text-ink-soft">{title} {i + 1}</span>
            {list.length > 1 && <button type="button" className="text-[12px] font-semibold text-heart underline" onClick={() => onChange(list.filter((_, j) => j !== i))}>Remove</button>}</div>
          <input className="field mt-2" placeholder="Short name" value={it.title} onChange={(e) => set(i, { title: e.target.value })} />
          <textarea className="field mt-2" rows={3} placeholder={hint} value={it.text} onChange={(e) => set(i, { text: e.target.value })} />
        </div>
      ))}
      <button type="button" className="btn-ghost h-10 min-h-0 px-3 text-[14px]" onClick={() => onChange([...list, { title: "", text: "" }])}><Plus size={16} />Add another</button>
    </div>
  );
}

export function ReportForm(p: Props) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>(p.initialAnswers);
  const [media, setMedia] = useState<MediaItem[]>(p.initialMedia);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState<"" | "saving" | "saved" | "error">("");
  const [res, setRes] = useState<ReportResult | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [sendBack, setSendBack] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const editable = p.mode === "trainer" ? p.status === "draft" || p.status === "changes_requested" : p.status !== "approved" || editing;
  const missing = useMemo(() => validate(p.kind, answers, media), [p.kind, answers, media]);
  const set = (k: string, v: unknown) => { setAnswers((a) => ({ ...a, [k]: v })); setDirty(true); };
  const setM = (m: MediaItem[]) => { setMedia(m); setDirty(true); };

  // Autosave 1.5 s after the last change, so a dropped signal or a closed tab doesn't lose work
  const latest = useRef({ answers, media }); latest.current = { answers, media };
  useEffect(() => {
    if (!dirty || !editable || p.demo) return;
    setSaved("saving");
    const t = setTimeout(async () => {
      const r = await saveReportAction(p.id, latest.current.answers, latest.current.media, p.status === "approved" && editing);
      setSaved(r.ok ? "saved" : "error"); if (r.ok) setDirty(false); else setRes(r);
    }, 1500);
    return () => clearTimeout(t);
  }, [answers, media, dirty, editable, p.demo, p.id, p.status, editing]);

  const run = (fn: () => Promise<ReportResult>, after?: (r: ReportResult) => void) => start(async () => { setRes(null); const r = await fn(); setRes(r); if (!r.missing?.length) setShowMissing(false); else setShowMissing(true); after?.(r); });
  const submit = () => { if (missing.length) { setShowMissing(true); window.scrollTo({ top: 0, behavior: "smooth" }); return; } if (window.confirm("Submit this report for review?")) run(() => submitReportAction(p.id, answers, media), (r) => { if (r.ok) router.refresh(); }); };
  const approve = () => { if (missing.length) { setShowMissing(true); window.scrollTo({ top: 0, behavior: "smooth" }); return; } if (p.kind !== "handover" || window.confirm(`Send this ${p.status === "approved" ? "corrected " : ""}report to ${s(answers.clientEmail)}?`)) run(() => approveReportAction(p.id, answers, media), (r) => { if (r.ok) { setEditing(false); router.push(r.nextId ? `/a/reports/${r.nextId}` : "/a/reports"); router.refresh(); } else { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); router.refresh(); } }); };

  const ro = !editable;
  const view = useMemo(() => buildReport(p.kind, answers, media, { startDate: p.startDate, endDate: p.endDate, submittedAt: p.submittedAt }), [p.kind, answers, media, p.startDate, p.endDate, p.submittedAt]);
  const html = useMemo(() => reportHtml(view, "/brand-logo.png"), [view]);

  // ── field renderers ──
  const label = (f: Field) => <span className="label">{f.label}{"required" in f && f.required ? <span className="text-heart"> *</span> : null}</span>;
  const renderField = (f: Field) => {
    const k = f.key;
    return (
      <div key={k} className="mt-5 first:mt-0">
        {f.type !== "confirm" && label(f)}
        {"hint" in f && f.hint && <p className="-mt-1 mb-1.5 text-[12px] text-ink-faint">{f.hint}</p>}
        {f.type === "text" && <input className="field" value={raw(answers[k])} onChange={(e) => set(k, e.target.value)} />}
        {f.type === "textarea" && <textarea className="field" rows={4} value={raw(answers[k])} onChange={(e) => set(k, e.target.value)} />}
        {f.type === "date" && <input type="date" className="field" value={raw(answers[k])} onChange={(e) => set(k, e.target.value)} />}
        {f.type === "number" && <input className="field" inputMode="decimal" value={raw(answers[k])} onChange={(e) => set(k, e.target.value)} />}
        {f.type === "confirm" && (
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white p-3.5 text-[15px]">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#2A1971]" checked={answers[k] === true} onChange={(e) => set(k, e.target.checked)} />
            <span>{f.label}<span className="text-heart"> *</span></span>
          </label>
        )}
        {f.type === "single" && <Chips name={k} options={f.options} value={[s(answers[k])]} multi={false} onChange={(v) => set(k, v[0])} />}
        {f.type === "multi" && (
          <>
            <Chips name={k} options={f.options} value={arr(answers[k])} multi onChange={(v) => set(k, v)} />
            {f.other && <input className="field mt-2" placeholder="Anything else" value={raw(answers[`${k}_other`])} onChange={(e) => set(`${k}_other`, e.target.value)} />}
          </>
        )}
        {f.type === "yesno" && (
          <>
            <Chips name={k} options={["No", "Yes"]} value={answers[k] === "yes" ? ["Yes"] : answers[k] === "no" ? ["No"] : []} multi={false} onChange={(v) => set(k, v[0] === "Yes" ? "yes" : "no")} />
            {(f.detail ?? "yes") !== "none" && answers[k] === (f.detail ?? "yes") && <textarea className="field mt-2" rows={2} placeholder={f.detailLabel ? `Tell us: ${f.detailLabel}` : "Describe it"} value={raw(answers[`${k}_detail`])} onChange={(e) => set(`${k}_detail`, e.target.value)} />}
          </>
        )}
      </div>
    );
  };
  const card = (title: string, children: React.ReactNode) => <section className="panel p-4 md:p-5"><h2 className="mb-4 text-[17px] font-bold">{title}</h2>{children}</section>;

  const emailMissing = !s(answers.clientEmail);
  const chatHref = p.chatId ? `${p.mode === "admin" ? "/a/chats/" : "/t/chats/"}${p.chatId}` : null;
  return (
    <div className="space-y-4">
      {p.status === "changes_requested" && p.reviewNote && (
        <div className="rounded-[18px] border border-biscuit bg-biscuit-wash p-4 text-[14px] text-[#8A5A00]"><p className="font-bold">The team sent this back</p><p className="mt-1 whitespace-pre-wrap">{p.reviewNote}</p></div>
      )}
      {p.mode === "trainer" && p.status === "submitted" && <div className="rounded-[18px] bg-mint-wash p-4 text-[14px] text-fern"><p className="font-bold">Submitted. Waiting for the team to review it.</p><p>You&apos;ll get an email if anything needs changing.</p></div>}
      {p.status === "approved" && (
        <div className={`rounded-[18px] p-4 text-[14px] ${p.kind === "handover" && p.meta.error ? "bg-heart-wash text-heart" : "bg-mint-wash text-fern"}`}>
          <p className="font-bold">{p.kind === "handover" ? "Approved" : "Reviewed"}{p.meta.approvedBy ? ` by ${p.meta.approvedBy}` : ""}{p.meta.approvedAt ? ` on ${new Date(p.meta.approvedAt).toLocaleDateString("en-US")}` : ""}.</p>
          {p.kind === "handover" && <p>{p.meta.error ? `Email not sent: ${p.meta.error}` : p.meta.sentTo ? `Sent to ${p.meta.sentTo}.` : "Not emailed yet."}</p>}
        </div>
      )}
      {p.mode === "admin" && p.status === "submitted" && p.late > 0 && <div className="rounded-[18px] bg-heart-wash p-3 text-[14px] text-heart">Submitted {p.late} day{p.late > 1 ? "s" : ""} after the deadline.</div>}
      {p.mode === "admin" && p.meta.byAdmin && p.status !== "approved" && <div className="rounded-[18px] bg-paper p-3 text-[13px] text-ink-soft">Started by an admin for the trainer.</div>}
      {p.mode === "admin" && editing && <div className="rounded-[18px] bg-biscuit-wash p-4 text-[14px] text-[#8A5A00]"><p className="font-bold">{p.kind === "handover" ? "Correcting an approved report." : "Editing a reviewed form."}</p>{p.kind === "handover" && <p>The client keeps the version they have until you send the corrected one.</p>}</div>}

      {showMissing && (missing.length > 0 || res?.missing?.length) && (
        <div role="alert" className="rounded-[18px] bg-heart-wash p-4 text-[14px] text-heart"><p className="font-bold">Still needed:</p><ul className="mt-1 list-disc pl-5">{(res?.missing?.length ? res.missing : missing).map((m) => <li key={m}>{m}</li>)}</ul></div>
      )}

      {ro ? (
        <div className="overflow-x-auto rounded-[18px] border border-line bg-white p-2"><div className="min-w-[520px]" dangerouslySetInnerHTML={{ __html: html }} /></div>
      ) : (
        <>
          {card("About this report", (
            <div className="space-y-3 text-[15px]">
              <p><b>{s(answers.dogName) || "Dog"}</b> <span className="text-ink-soft">with {s(answers.clientName)}. Trainer {s(answers.trainerName)}.</span></p>
              <p className="text-ink-soft">{deadlineHint(p.kind)}{p.due ? ` Due ${new Date(p.due).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" })}.` : ""}</p>
              {p.kind !== "handover" && (
                <p className="rounded-xl bg-paper p-3 text-[14px]">Send photos and videos in the dog&apos;s chat, not on this form. {chatHref ? <Link href={chatHref} className="font-semibold underline">Open the chat</Link> : "This dog has no chat yet: ask the team to start one."}</p>
              )}
              {p.kind === "handover" && (
                <>
                  <label className="block"><span className="label">Client&apos;s email (the report is sent here){emailMissing && <span className="text-heart"> *</span>}</span>
                    <input className="field" inputMode="email" value={raw(answers.clientEmail)} onChange={(e) => set("clientEmail", e.target.value)} disabled={p.mode === "trainer" && !emailMissing} /></label>
                  {p.mode === "trainer" && !emailMissing && <p className="text-[12px] text-ink-faint">Taken from the booking. Ask the team if it&apos;s wrong.</p>}
                </>
              )}
            </div>
          ))}

          {p.kind === "weekly" ? WEEKLY_SECTIONS.map((sec) => card(sec.title, sec.fields.map(renderField))) : p.kind === "intake" ? INTAKE_SECTIONS.map((sec) => card(sec.title, sec.fields.map(renderField))) : (
            <>
              {card("Program and goals", [...HANDOVER_SIMPLE.map(renderField)])}
              {card("Training details", (
                <>
                  <ItemList title="Training" value={rawItems(answers.training)} onChange={(v) => set("training", v)} hint="What was done, and an explanation." />
                  <MediaPicker bookingId={p.bookingId} slot="training" kind="video" label="Training videos from the chat (optional)" items={media} onChange={setM} describe chatHref={chatHref} />
                </>
              ))}
              {card("Homework details", (
                <>
                  <ItemList title="Homework" value={rawItems(answers.homework)} onChange={(v) => set("homework", v)} hint="Clear directions, personalized for this client." />
                  <MediaPicker bookingId={p.bookingId} slot="homework" kind="video" label="Homework videos from the chat (optional)" items={media} onChange={setM} describe chatHref={chatHref} />
                </>
              ))}
              {card("Health check and review", HANDOVER_AFTER.map(renderField))}
              {card("Photo with the trainer", (
                <>
                  <span className="label">Photo of the dog with the trainer <span className="text-heart">*</span></span>
                  <MediaPicker bookingId={p.bookingId} slot="health" kind="photo" label="Pick a photo from the chat" items={media} onChange={setM} describe={false} chatHref={chatHref} />
                </>
              ))}
            </>
          )}
        </>
      )}

      {res && !res.missing?.length && <p role="status" className={`rounded-xl px-3 py-2 text-[14px] ${res.ok ? "bg-mint-wash text-fern" : "bg-heart-wash text-heart"}`}>{res.message}</p>}

      {sendBack && (
        <div className="panel p-4">
          <label className="block"><span className="label">What needs changing? (the trainer gets this by email)</span><textarea className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="mt-3 flex gap-2"><button type="button" className="btn-ghost flex-1" onClick={() => setSendBack(false)}>Cancel</button>
            <button type="button" className="btn-ink flex-1" disabled={pending} onClick={() => run(() => sendBackAction(p.id, note), (r) => { if (r.ok) { router.push(r.nextId ? `/a/reports/${r.nextId}` : "/a/reports"); router.refresh(); } })}>{pending ? "Sending…" : "Send back"}</button></div>
        </div>
      )}

      <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 rounded-[20px] border border-line bg-white/95 p-2 backdrop-blur md:bottom-4">
        {editable && <p className="px-2 pb-1 text-[12px] text-ink-faint" aria-live="polite">{p.demo ? "Demo: nothing saves." : saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "error" ? "Couldn't save: check your signal" : "Your answers save as you go."}{missing.length > 0 ? ` ${missing.length} thing${missing.length > 1 ? "s" : ""} still needed.` : " Ready to send."}</p>}
        <div className="flex gap-2">
          {p.mode === "trainer" && editable && <button type="button" className="btn-ink flex-1" disabled={pending} onClick={submit}>{pending ? "Submitting…" : "Submit for review"}</button>}
          {p.mode === "admin" && editable && (
            <>
              {p.status !== "approved" && !p.meta.byAdmin && <button type="button" className="btn-ghost whitespace-nowrap px-3" disabled={pending} onClick={() => setSendBack((v) => !v)}>Send back</button>}
              {editing && <button type="button" className="btn-ghost whitespace-nowrap px-3" onClick={() => { setEditing(false); router.refresh(); }}>Cancel</button>}
              <button type="button" className="btn-ink flex-1 whitespace-nowrap px-3" disabled={pending} onClick={approve}>{pending ? (p.kind === "handover" ? "Sending…" : "Saving…") : p.kind !== "handover" ? (editing ? "Save changes" : "Mark as reviewed") : editing ? "Send corrected report" : "Approve and send"}</button>
            </>
          )}
          {p.mode === "admin" && p.status === "approved" && !editing && (
            <>
              <button type="button" className="btn-ink flex-1" onClick={() => setEditing(true)}>Edit</button>
              {p.kind === "handover" && <button type="button" className="btn-ghost flex-1" disabled={pending} onClick={() => run(() => resendReportAction(p.id))}>{pending ? "Sending…" : "Email again"}</button>}
            </>
          )}
          {!(p.mode === "trainer" && p.status === "draft") && <a className="btn-ghost" href={`/api/reports/${p.id}/pdf`} target="_blank">PDF</a>}
        </div>
      </div>
    </div>
  );
}
