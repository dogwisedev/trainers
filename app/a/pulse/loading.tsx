import { PulseLoading } from "@/components/PulseLoading";
import { Pill } from "@/components/ui";

/** Shown the instant Pulse is opened, while the numbers load (Next streams the page in when it's ready). */
export default function Loading() {
  return (
    <>
      <div className="mb-3">
        <h1 className="text-h1 font-extrabold leading-tight">Pulse <Pill tone="line">Preview</Pill></h1>
        <p className="text-body text-ink-soft">Getting the numbers…</p>
      </div>
      <div className="mb-4 h-12 w-full max-w-md rounded-2xl border border-line bg-white p-1 sm:w-auto"><div className="skeleton h-full w-full" /></div>
      <PulseLoading />
    </>
  );
}
