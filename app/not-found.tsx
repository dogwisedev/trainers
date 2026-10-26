import Link from "next/link";

export default function NotFound() {
  return (
    <main className="px-4 py-16">
      <div className="mx-auto max-w-md rounded-[24px] border border-line bg-white p-6 text-center shadow-card">
        <p className="text-h3 font-extrabold">That page isn&apos;t here</p>
        <p className="mt-2 text-body text-ink-soft">It may have been moved, or the chat was closed. Your home screen has everything that&apos;s current.</p>
        <Link href="/" className="btn-ink mt-5 w-full">Go to the home screen</Link>
      </div>
    </main>
  );
}
