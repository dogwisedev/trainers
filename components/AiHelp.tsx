import Link from "next/link";
import { serviceClient } from "@/lib/supabase";
import { aiOn } from "@/lib/ai";
import { aiSettings } from "@/lib/aiSettings";
import { formCheckStats } from "@/lib/formCheck";
import { handoverDraftStats } from "@/lib/handoverDraft";
import { CheckModeSwitch, OnOff } from "@/components/AiSwitches";

/** Pulse → Office: the AI help's switches and how it's doing over the range (lib/formCheck.ts, lib/handoverDraft.ts, captions). */
export async function AiHelp({ from, label }: { from: string; label: string }) {
  const sb = serviceClient(), since = `${from}T00:00:00Z`;
  const [cfg, checks, drafts, caps] = await Promise.all([
    aiSettings(sb), formCheckStats(sb, since).catch(() => null), handoverDraftStats(sb, since).catch(() => null),
    sb.from("ai_captions").select("suggested, final, used_at").gte("created_at", since).limit(5000).then((r) => (r.error ? null : (r.data || []) as { suggested: string; final: string | null; used_at: string | null }[]), () => null)
  ]);
  const used = (caps || []).filter((c) => c.used_at), asIs = used.filter((c) => (c.final || "").trim() === c.suggested.trim()).length;
  const row = (title: string, what: string, control: React.ReactNode, stats: string) => (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1 basis-64"><p className="font-bold">{title}</p><p className="text-small text-ink-soft">{what}</p><p className="mt-1.5 text-small font-semibold tabular-nums">{stats}</p></div>
      {control}
    </li>
  );
  return (
    <section className="mt-6" aria-label="AI help">
      <h2 className="mb-2 text-lead font-extrabold">AI help <span className="text-small font-normal text-ink-soft">{label}</span></h2>
      {!aiOn() && <p className="mb-2 rounded-xl bg-biscuit-wash px-3 py-2 text-small font-semibold text-warn">Not running: add ANTHROPIC_API_KEY in Vercel.</p>}
      {(checks === null || drafts === null || caps === null) && <p className="mb-2 rounded-xl bg-biscuit-wash px-3 py-2 text-small font-semibold text-warn">Run migration 055 in Supabase to switch this on.</p>}
      <ul className="panel divide-y divide-line">
        {row("Form checks", "Each submitted form is checked against its checklist: \"fits the standard\" or what to look at. \"Approve clean ones\" lets weekly checks and intake forms with nothing to look at approve themselves; handover reports always come to a person.",
          <CheckModeSwitch mode={cfg.formCheck} />,
          checks && checks.checked ? `${checks.checked} checked: ${checks.fits} fit, ${checks.toCheck} to look at${checks.auto ? `, ${checks.auto} approved by itself` : ""}. ${checks.agreedPct === null ? "No admin decisions yet." : `Admins agreed on ${checks.agreedPct}% (${checks.agreed} of ${checks.decided}); ${checks.fitsButSentBack} it passed were sent back or changed, ${checks.flaggedButFine} it flagged were approved as they were.`}` : "Nothing checked in this range yet.")}
        {row("Handover drafts", "The evening before a dog goes home, the app starts the handover report from the chat, the weekly checks and the owner's answers. The trainer checks it, changes anything and sends it.",
          <OnOff name="handoverDrafts" on={cfg.handoverDrafts} label="Handover drafts" />,
          drafts && (drafts.drafted || drafts.tooThin) ? `${drafts.drafted} started${drafts.tooThin ? `, ${drafts.tooThin} not (too few updates in the chat)` : ""}. ${drafts.sent ? `Of ${drafts.sent} sent in: ${drafts.keptPct}% of parts kept as drafted, ${drafts.editedPct}% edited, ${drafts.rewrittenPct}% rewritten.` : "None sent in yet."}` : "None started in this range yet.")}
        {row("Update captions", "In a dog's chat, a trainer types a few words and the app suggests a short update in their own voice. They can change it before sending.",
          <OnOff name="captions" on={cfg.captions} label="Update captions" />,
          caps && caps.length ? `${caps.length} suggested, ${used.length} sent (${asIs} as suggested, ${used.length - asIs} changed first).` : "None suggested in this range yet.")}
      </ul>
      <p className="mt-2 text-small text-ink-soft"><Link prefetch={false} href="/a/ai" className="font-semibold underline">Change the checklists</Link> forms are checked against.</p>
    </section>
  );
}
