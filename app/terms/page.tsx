import { getTerms } from "@/lib/terms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Terms & Conditions · Dogwise Academy" };
/** Public: the exact Terms & Conditions clients agree to in the app (the version pasted on /a/terms). */
export default async function Terms() {
  const t = await getTerms().catch(() => null);
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-h1 font-extrabold">Terms &amp; Conditions</h1>
      <p className="mt-1 text-small text-ink-soft">Dogwise Academy · version {t?.version || "as published"}</p>
      {t?.text.trim() ? <div className="mt-6 whitespace-pre-wrap text-body leading-relaxed">{t.text}</div>
        : <p className="mt-6 text-body">Our full Terms &amp; Conditions are at <a className="underline" href={t?.url || "https://www.dogwiseacademy.com/termsandconditions"}>{t?.url || "dogwiseacademy.com/termsandconditions"}</a>.</p>}
      {t?.data.trim() && <div className="mt-10 border-t border-line pt-6"><h2 className="text-lead font-extrabold">{t.data.split("\n")[0]}</h2><div className="mt-3 whitespace-pre-wrap text-body leading-relaxed">{t.data.split("\n").slice(1).join("\n").trim()}</div></div>}
    </main>
  );
}
