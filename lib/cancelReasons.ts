// Why a training was cancelled: picked on the dog page's Cancel training step (bookings.cancel_reason, migration 040).
// Kept short so the dashboard can count them. "Other" needs a note.
export const CANCEL_REASONS = [
  "Client changed their mind",
  "Dates or schedule",
  "Money or payment",
  "Dog's health or vet advice",
  "Behavior: not the right program",
  "Moving to another program or trainer",
  "Other"
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
export const isCancelReason = (s: string): s is CancelReason => (CANCEL_REASONS as readonly string[]).includes(s);
