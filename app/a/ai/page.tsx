import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { aiSettings, DEFAULT_CHECKLISTS } from "@/lib/aiSettings";
import { ChecklistEditor } from "@/components/AiSwitches";

export const dynamic = "force-dynamic";
/** The checklists submitted forms are checked against (lib/formCheck.ts). Any admin can change them. */
export default async function AiChecklists() {
  await requireRole("admin");
  const cfg = await aiSettings();
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link prefetch={false} href="/a/pulse" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back to Pulse"><ChevronLeft /></Link>
        <div><h1 className="text-h2 font-extrabold leading-tight">Form checklists</h1><p className="text-body text-ink-soft">What the app checks each submitted form against, before you approve it.</p></div>
      </div>
      <div className="max-w-2xl space-y-4">
        <ChecklistEditor kind="weekly" title="Weekly health check" text={cfg.checklists.weekly} builtIn={DEFAULT_CHECKLISTS.weekly} />
        <ChecklistEditor kind="intake" title="Intake form" text={cfg.checklists.intake} builtIn={DEFAULT_CHECKLISTS.intake} />
        <ChecklistEditor kind="handover" title="Handover report" text={cfg.checklists.handover} builtIn={DEFAULT_CHECKLISTS.handover} />
      </div>
    </>
  );
}
