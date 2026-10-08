import Link from "next/link";

const TONES = ["bg-mint text-ink", "bg-biscuit text-ink", "bg-ink text-white", "bg-heart-wash text-heart", "bg-mint-wash text-fern"];
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initials = name.replace(/["']/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  const tone = TONES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length];
  return (
    <span className={`inline-grid shrink-0 place-items-center rounded-full font-bold ${tone}`} style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden>
      {initials}
    </span>
  );
}

export function Pill({ children, tone = "mint" }: { children: React.ReactNode; tone?: "mint" | "biscuit" | "heart" | "ink" | "line" }) {
  const t = { mint: "bg-mint-wash text-fern", biscuit: "bg-biscuit-wash text-[#8A5A00]", heart: "bg-heart-wash text-heart", ink: "bg-ink text-white", line: "bg-paper text-ink-soft border border-line" }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${t}`}>{children}</span>;
}

export function Section({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`mt-7 ${className}`}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-[19px] font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children, href, cta }: { title: string; children?: React.ReactNode; href?: string; cta?: string }) {
  return (
    <div className="rounded-[22px] border border-dashed border-line bg-white/60 p-6 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 text-[14px] text-ink-soft">{children}</p>}
      {href && cta && <Link href={href} className="btn-mint mt-4">{cta}</Link>}
    </div>
  );
}

export function DemoBanner() {
  return (
    <div className="bg-biscuit-wash px-4 py-2 text-center text-[13px] text-[#8A5A00]">
      Demo mode with today&apos;s sheet data. Changes won&apos;t save until Supabase is connected.
    </div>
  );
}
