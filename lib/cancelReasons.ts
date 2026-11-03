// Why a training was cancelled: exactly HubSpot's Cancellation Reason options (deal property cancellation_reason), so
// every cancellation in the app is written to the deal as it is. "Other" goes to Cancellation Info as text.
export const CANCEL_REASONS = [
  "Normal - Less than 14 days from PU",
  "Normal - More than 14 days from PU",
  "No follow up from the client",
  "Cannot afford to pay for the program",
  "Rescheduling issues",
  "Trainer availability issues",
  "Dog was Rehomed/Given away",
  "Death of the dog",
  "Other"
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
export const isCancelReason = (s: string): s is CancelReason => (CANCEL_REASONS as readonly string[]).includes(s);
/** Who asked to postpone: HubSpot's drop_off_postponed options. */
export const POSTPONE_BY = ["By client's request", "By trainer's request"] as const;
