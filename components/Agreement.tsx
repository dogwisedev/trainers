"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, FileSignature } from "lucide-react";

/** The last part of the before-training details: they tick that they've read the Terms & Conditions (linked, opens the
 *  exact version they're agreeing to), then type their full name. Both are needed to save. */
export function Agreement({ signed, onSave, id = "sec-agreement", canEdit = true }: { signed: string; onSave: (values: Record<string, string>) => Promise<{ ok: boolean; message: string }>; id?: string; canEdit?: boolean }) {
  const router = useRouter();
  const [read, setRead] = useState(false), [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (signed.trim()) return (
    <section id={id} className="panel flex items-start gap-3 p-4">
      <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-fern" />
      <div><p className="font-bold">Your agreement</p><p className="text-body text-ink-soft">Agreed to the <a href="/terms" target="_blank" rel="noopener" className="font-semibold underline">Terms &amp; Conditions</a> as <b>{signed}</b>. Thank you!</p></div>
    </section>
  );
  if (!canEdit) return null;
  return (
    <section id={id} className="panel p-4">
      <h2 className="flex items-center gap-2 text-lead font-bold"><FileSignature size={19} />Your agreement</h2>
      <p className="mt-1 text-body text-ink-soft">Last step: please read our Terms &amp; Conditions, then agree below.</p>
      <a href="/terms" target="_blank" rel="noopener" className="mt-3 flex min-h-[48px] items-center justify-between rounded-xl border border-line bg-paper px-4 font-semibold text-lav-deep hover:bg-mint-wash">Read the Terms &amp; Conditions<span aria-hidden>↗</span></a>
      <label className="mt-3 flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border border-line px-3.5 py-3 text-body">
        <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#281870]" />
        <span>I have read and agree to the Dogwise Academy Terms &amp; Conditions.</span>
      </label>
      <label className="mt-3 block"><span className="label">Type your full name to sign</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="field" autoComplete="name" placeholder="Your full name" /></label>
      <button type="button" className="btn-ink mt-3 w-full" disabled={pending || !read || name.trim().length < 2}
        onClick={() => start(async () => { const r = await onSave({ signature: name.trim(), __terms_read: "yes" }); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); })}>{pending ? "Saving…" : "Agree and sign"}</button>
      {msg && <p role="status" className={`mt-2 text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </section>
  );
}
