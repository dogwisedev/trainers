import Link from "next/link";
import { Check, ChevronRight, ExternalLink, X } from "lucide-react";
import type { HistoryRow } from "@/lib/history";
import { rowStatus, type Tone } from "@/lib/dogStatus";

// Dogs (admin): one card per dog. A coloured dot (red wrong · amber a look · green on track · grey nothing to do), the
// headline in words, what needs doing, and the forms so far (only what's happened, and the next one due).
const DOT: Record<Tone, string> = { red: "bg-bad", amber: "bg-amber", green: "bg-ok", grey: "bg-line" };
const TXT: Record<Tone, string> = { red: "text-bad", amber: "text-amber", green: "text-ok", grey: "text-ink-soft" };
const short = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function DogRows({ rows, tab, today, before }: { rows: HistoryRow[]; tab: string; today: string; before: Record<string, number> }) {
  return (
    <ul className="panel divide-y divide-line">
      {rows.map((b) => {
        const s = rowStatus(b, tab, today, before[b.id] ?? null);
        return (
          <li key={b.id} className="relative">
            <Link prefetch={false} href={`/a/dogs/${b.id}`} className="flex gap-3 p-3.5 hover:bg-paper/50">
              <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${DOT[s.tone]}`} aria-label={s.tone === "red" ? "Needs action" : s.tone === "amber" ? "Needs a look" : s.tone === "green" ? "On track" : ""} />
              <span className="min-w-0 flex-1">
                <span className="block truncate"><b>{b.dog_name || "Dog"}</b> <span className="text-ink-soft">· {b.client_name}</span></span>
                <span className="block truncate text-small text-ink-soft">{[b.trainers?.name, b.program || `${b.weeks}-week`, `${short(b.start_date)} – ${short(b.end_date)}`, b.poc && `POC ${b.poc}`].filter(Boolean).join(" · ")}</span>
                <span className={`mt-1 block text-small font-semibold ${s.tone === "red" && !s.issues.length ? TXT.red : "text-ink"}`}>{s.headline}</span>
                {s.issues.length > 0 && <span className="mt-0.5 block text-small">{s.issues.map((x, i) => <span key={i} className={`font-semibold ${TXT[x.tone]}`}>{i ? " · " : ""}{x.text}</span>)}</span>}
                {s.steps.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-caption">
                    {s.steps.map((x) => (
                      <span key={x.label} className={`inline-flex items-center gap-0.5 ${x.state === "in" ? "text-ok" : x.state === "late" ? "text-amber" : x.state === "missing" ? "text-bad font-semibold" : "text-ink-faint"}`}>
                        {x.state === "in" || x.state === "late" ? <Check size={12} /> : x.state === "missing" ? <X size={12} /> : null}{x.label}{x.state === "late" ? " (late)" : ""}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <ChevronRight size={18} className="mt-1 shrink-0 text-ink-faint" />
            </Link>
            {b.hubspot_deal_id && <a href={`https://app.hubspot.com/contacts/21869370/record/0-3/${b.hubspot_deal_id}`} target="_blank" rel="noopener" className="absolute right-9 top-3.5 hidden items-center gap-1 text-caption text-ink-faint hover:text-ink sm:inline-flex" aria-label="HubSpot deal">HubSpot<ExternalLink size={11} /></a>}
          </li>
        );
      })}
    </ul>
  );
}
