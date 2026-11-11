import Link from "next/link";
import { serviceClient } from "@/lib/supabase";
import { aiOn } from "@/lib/ai";
import { aiSettings } from "@/lib/aiSettings";
import { formCheckStats } from "@/lib/formCheck";
import { handoverDraftStats } from "@/lib/handoverDraft";
import { vaccineCheckStats } from "@/lib/vaccineCheck";
import { needsStats } from "@/lib/clientNeeds";
import { AutoSwitch, CheckModeSwitch, OnOff, RatePill } from "@/components/AiSwitches";
import { aiFlags, aiRates, AUTO_MIN_DECISIONS, AUTO_MIN_RATE, SPOT_EVERY, WEEKS, type Feature } from "@/lib/aiTrust";

/** Pulse → Office: the AI help's switches and how it's doing over the range (lib/formCheck.ts, lib/handoverDraft.ts, captions). */
export async function AiHelp({ from, label }: { from: string; label: string }) {
  const sb = serviceClient(), since = `${from}T00:00:00Z`;
  const [cfg, checks, drafts, caps, voice, vax] = await Promise.all([
    aiSettings(sb), formCheckStats(sb, since).catch(() => null), handoverDraftStats(sb, since).catch(() => null),
    sb.from("ai_captions").select("suggested, final, used_at").gte("created_at", since).limit(5000).then((r) => (r.error ? null : (r.data || []) as { suggested: string; final: string | null; used_at: string | null }[]), () => null),
    sb.from("ai_voice").select("mode, user_id, seconds, fields_set").gte("created_at", since).limit(5000).then((r) => (r.error ? null : (r.data || []) as { mode: string; user_id: string | null; seconds: number | null; fields_set: number | null }[]), () => null),
    vaccineCheckStats(sb, since).catch(() => null)
  ]);
  const [rates, flags, msgs] = await Promise.all([aiRates(sb).catch(() => null), aiFlags(sb).catch(() => null), needsStats(sb, since).catch(() => null)]);
  const pill = (f: Feature) => rates ? <RatePill rate={rates[f].rate} decided={rates[f].decided} what={rates[f].what} weeks={WEEKS} /> : null;
  const vChat = (voice || []).filter((x) => x.mode === "chat"), vForm = (voice || []).filter((x) => x.mode === "form");
  const used = (caps || []).filter((c) => c.used_at), asIs = used.filter((c) => (c.final || "").trim() === c.suggested.trim()).length;
  const row = (title: string, what: string, control: React.ReactNode, stats: string, f?: Feature, auto?: React.ReactNode) => (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1 basis-64"><p className="font-bold">{title}</p><p className="text-small text-ink-soft">{what}</p>
        {(f || auto) && <div className="mt-2 flex flex-wrap items-center gap-2">{f && pill(f)}{auto}</div>}
        <p className="mt-1.5 text-small font-semibold tabular-nums">{stats}</p></div>
      {control}
    </li>
  );
  return (
    <section className="mt-6" aria-label="AI help">
      <h2 className="mb-2 text-lead font-extrabold">AI help <span className="text-small font-normal text-ink-soft">{label}</span></h2>
      {!aiOn() && <p className="mb-2 rounded-xl bg-biscuit-wash px-3 py-2 text-small font-semibold text-warn">Not running: add ANTHROPIC_API_KEY in Vercel, then redeploy.</p>}
      {aiOn() && <p className="mb-2 text-small text-ink-soft">Not doing what you expect? <a href="/api/ai/test" target="_blank" rel="noopener" className="font-semibold underline">Test the connection to Claude</a>: it shows exactly what Claude answers.</p>}
      {(checks === null || drafts === null || caps === null) && <p className="mb-2 rounded-xl bg-biscuit-wash px-3 py-2 text-small font-semibold text-warn">Run migration 055 in Supabase to switch this on.</p>}
      <ul className="panel divide-y divide-line">
        {row("Form checks", "Each submitted form is checked against its checklist: \"fits the standard\" or what to look at. \"Approve clean ones\" lets weekly checks and intake forms with nothing to look at approve themselves; handover reports always come to a person.",
          <CheckModeSwitch mode={cfg.formCheck} />,
          checks && checks.checked ? `${checks.checked} checked: ${checks.fits} fit, ${checks.toCheck} to look at${checks.auto ? `, ${checks.auto} approved by itself` : ""}. ${checks.agreedPct === null ? "No admin decisions yet." : `Admins agreed on ${checks.agreedPct}% (${checks.agreed} of ${checks.decided}); ${checks.fitsButSentBack} it passed were sent back or changed, ${checks.flaggedButFine} it flagged were approved as they were.`}` : "Nothing checked in this range yet.", "forms", rates ? <AutoSwitch feature="forms" on={cfg.formCheck === "auto"} canAuto={rates.forms.canAuto} need={rates.forms.need} /> : null)}
        {row("Handover drafts", "The evening before a dog goes home, the app starts the handover report from the chat, the weekly checks and the owner's answers. The trainer checks it, changes anything and sends it.",
          <OnOff name="handoverDrafts" on={cfg.handoverDrafts} label="Handover drafts" />,
          drafts && (drafts.drafted || drafts.tooThin) ? `${drafts.drafted} started${drafts.tooThin ? `, ${drafts.tooThin} not (too few updates in the chat)` : ""}. ${drafts.sent ? `Of ${drafts.sent} sent in: ${drafts.keptPct}% of parts kept as drafted, ${drafts.editedPct}% edited, ${drafts.rewrittenPct}% rewritten.` : "None sent in yet."}` : "None started in this range yet.", "handover")}
        {row("Update captions", "In a dog's chat, a trainer types a few words and the app suggests a short update in their own voice. They can change it before sending.",
          <OnOff name="captions" on={cfg.captions} label="Update captions" />,
          caps && caps.length ? `${caps.length} suggested, ${used.length} sent (${asIs} as suggested, ${used.length - asIs} changed first).` : "None suggested in this range yet.", "captions")}
        {row("Vaccine checks", "When vaccine records are uploaded in the app, they're read for Rabies, Bordetella and the distemper combination, each valid through the last day of the stay. The dog page and To do say \"all in order\", what's missing, or \"needs a person\". An admin always confirms.",
          <OnOff name="vaccineChecks" on={cfg.vaccineChecks} label="Vaccine checks" />,
          vax === null ? "Run migration 057 in Supabase to switch this on." : vax.checked ? `${vax.checked} checked: ${vax.inOrder} in order, ${vax.missing} missing or running out, ${vax.byHand} for a person. ${vax.agreedPct === null ? "No admin decisions yet." : `Admins agreed on ${vax.agreedPct}% (${vax.agreed} of ${vax.decided}).`}` : "None checked in this range yet.", "vaccines", rates ? <AutoSwitch feature="vaccines" on={cfg.vaccineAuto} canAuto={rates.vaccines.canAuto} need={rates.vaccines.need} /> : null)}
        {row("Speak", "A Speak button in chats and on forms: the person talks, it's turned into text and tidied into a message in their own way of talking, or into the form's answers. Never a voice message: they check the text and send it themselves.",
          <OnOff name="voice" on={cfg.voice} label="Speak" />,
          voice === null ? "Run migration 056 in Supabase to count uses." : voice.length ? `${vChat.length} chat message${vChat.length === 1 ? "" : "s"} and ${vForm.length} form fill${vForm.length === 1 ? "" : "s"} spoken (${vForm.reduce((n, x) => n + (x.fields_set || 0), 0)} answers filled in) by ${new Set(voice.map((x) => x.user_id)).size} ${new Set(voice.map((x) => x.user_id)).size === 1 ? "person" : "people"}, ${Math.round(voice.reduce((n, x) => n + (x.seconds || 0), 0) / 60)} minutes of talking.` : "Nobody has used it in this range yet.", "speak")}
        {row("Reading client messages", "Each new client message is labelled: for the trainer, for the office, no reply needed, or urgent. That decides who is reminded and what goes on To do. Off: no labels, and a client who wrote last counts as waiting, as before.",
          <OnOff name="messages" on={cfg.messages} label="Reading client messages" />,
          msgs ? (msgs.labelled ? `${msgs.labelled} labelled (${msgs.byClaude} by Claude, ${msgs.byRules} by the simple rules): ${msgs.reply} for the trainer, ${msgs.office} for the office, ${msgs.none} no reply needed, ${msgs.urgent} urgent. ${msgs.changedByPeople} changed by a person.` : "None labelled in this range yet.") : "Run migration 052 in Supabase.")}
      </ul>
      <p className="mt-2 text-small text-ink-soft"><b>How Auto works:</b> it can only be switched on when people have agreed with the AI on at least {AUTO_MIN_RATE}% of {AUTO_MIN_DECISIONS}+ decisions in the last {WEEKS} weeks. Small edits (a typo, a word) count as agreeing. While it&apos;s on, 1 in {SPOT_EVERY} still goes to a person as a spot check, and if they disagree too often it switches itself off and tells the admins.</p>
      {flags && flags.length > 0 && (
        <div className="mt-4">
          <h3 className="text-body font-extrabold">Worth a look</h3>
          <p className="text-small text-ink-soft">Patterns in how the AI&apos;s work is being decided, over the last {WEEKS} weeks. Each one can be innocent: they&apos;re a reason to look together, not a verdict.</p>
          <ul className="panel mt-2 divide-y divide-line">{flags.map((f, i) => (
            <li key={i} className="px-4 py-2.5 text-small"><span className={`mr-2 rounded-full px-2 py-0.5 text-caption font-semibold ${f.kind === "changed_back" ? "bg-biscuit-wash text-warn" : f.kind === "fast" ? "bg-heart-wash text-heart" : "bg-paper text-ink-soft"}`}>{f.kind === "changed_back" ? "Changed back" : f.kind === "fast" ? "Very quick" : "Disagrees more"}</span>{f.text}</li>
          ))}</ul>
        </div>
      )}
      <p className="mt-2 text-small text-ink-soft"><Link prefetch={false} href="/a/ai" className="font-semibold underline">Change the checklists</Link> forms are checked against.</p>
    </section>
  );
}
