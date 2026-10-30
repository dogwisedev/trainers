import { PulseLoading } from "@/components/PulseLoading";

/** Shown the moment Sales opens, while the month's figures and the comparisons load. */
export default function Loading() {
  return (
    <>
      <h1 className="text-h1 font-extrabold leading-tight">Sales</h1>
      <p className="mt-1 text-ink-soft">Getting the month&apos;s figures…</p>
      <div className="mt-6"><PulseLoading steps={["This month's sales", "The same month last year", "Last month", "Leads and calls", "Lost deals and payment plans", "Working it out"]} lines={["One moment.", "Asking HubSpot nicely.", "Comparing with last year.", "Counting the calls.", "Nearly there."]} note="Once a month has loaded, it's kept for an hour, so the next look is instant." /></div>
    </>
  );
}
