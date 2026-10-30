import { ChevronDown, Chrome, ExternalLink } from "lucide-react";

// The two Chrome extensions the sales team uses, with where to get them and how to install one ("load unpacked").
const STEPS = [
  "Open the Drive folder and download it (right-click the folder → Download). It comes as a zip; unzip it somewhere you'll keep it.",
  "In Chrome, go to chrome://extensions and switch on Developer mode (top right).",
  "Click Load unpacked and pick the unzipped folder (the one with manifest.json inside).",
  "Pin it from the puzzle-piece icon. To update later, download the folder again and press the refresh arrow on the extension."
];
const TOOLS: { key: string; name: string; what: string; url: string; adminOnly: boolean }[] = [
  { key: "bark-buster", name: "Bark Buster", what: "For the Bark lead feed.", url: "https://drive.google.com/drive/u/0/folders/1LU8DGzIEGH5H9CFTblhR74jRprjBiQCy", adminOnly: true },
  { key: "sales-assistant", name: "Sales Assistant", what: "Helps on calls and in HubSpot.", url: "https://drive.google.com/drive/folders/1E8tj78MqR4LppCl9Jd0oOFuxIrjDCnYF?usp=drive_link", adminOnly: false }
];

export function SalesExtensions({ admin }: { admin: boolean }) {
  const tools = TOOLS.filter((t) => admin || !t.adminOnly);
  return (
    <section className="panel p-4" aria-labelledby="ext-h">
      <h2 id="ext-h" className="text-lead font-extrabold">Chrome extensions</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {tools.map((t) => (
          <a key={t.key} href={t.url} target="_blank" rel="noopener" className="btn-ink h-11 min-h-0 px-4 text-body"><Chrome size={17} />{t.name}<ExternalLink size={14} /></a>
        ))}
      </div>
      <p className="mt-2 text-small text-ink-soft">{tools.map((t) => `${t.name}: ${t.what}`).join(" ")} Each button opens the Drive folder with the files.</p>
      <details className="group mt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-small font-semibold text-ink-soft [&::-webkit-details-marker]:hidden">How to load unpacked<ChevronDown size={14} className="transition group-open:rotate-180" /></summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-small text-ink-soft">{STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
      </details>
    </section>
  );
}
