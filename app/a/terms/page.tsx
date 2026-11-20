import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { serviceClient } from "@/lib/supabase";
import { getTerms } from "@/lib/terms";
import { TermsEditor } from "@/components/TermsEditor";

export const dynamic = "force-dynamic";
/** The Terms & Conditions the agreement copy carries, and the record of every client who agreed (migration 063). */
export default async function TermsPage() {
  await requireRole("admin");
  const sb = serviceClient();
  const [terms, { data: recs }] = await Promise.all([getTerms(sb), sb.from("terms_acceptances").select("deal_id, name, contact_email, source, ip, at, emailed_at, email_error, terms_version").order("at", { ascending: false }).limit(50)]);
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link prefetch={false} href="/a" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back"><ChevronLeft /></Link>
        <div><h1 className="text-h2 font-extrabold leading-tight">Terms &amp; Conditions</h1><p className="text-body text-ink-soft">What clients agree to, and the record of each one. Current version: {terms.version}.</p></div>
      </div>
      <div className="max-w-3xl space-y-4">
        <TermsEditor text={terms.text} data={terms.data} />
        <section className="panel overflow-hidden">
          <h2 className="border-b border-line bg-paper/60 px-4 py-2.5 text-body font-extrabold">Agreed, latest first</h2>
          {recs?.length ? <ul className="divide-y divide-line">{(recs as { deal_id: string; name: string; contact_email: string | null; source: string; ip: string | null; at: string; emailed_at: string | null; email_error: string | null; terms_version: string | null }[]).map((r, i) => (
            <li key={i} className="px-4 py-2.5 text-body"><b>{r.name}</b> · {r.contact_email || "no email"}<span className="block text-caption text-ink-faint">{when(r.at)} ET · {r.source === "hubspot" ? "HubSpot form" : r.source === "admin" ? "entered by the office" : "in the app"}{r.ip ? ` · ${r.ip}` : ""} · version {r.terms_version || "?"} · {r.emailed_at ? "welcome sent" : r.email_error ? `email failed: ${r.email_error}` : "no welcome (already sent, or no email)"} · <a className="underline" href={`https://app.hubspot.com/contacts/21869370/record/0-3/${r.deal_id}`} target="_blank" rel="noopener">deal</a></span></li>))}</ul>
          : <p className="px-4 py-3 text-small text-ink-soft">Nobody yet. Run migration 063 if this stays empty after clients sign.</p>}
        </section>
      </div>
    </>
  );
}
