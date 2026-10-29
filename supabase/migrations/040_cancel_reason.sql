-- 040: Why a training was cancelled (asked on the dog page's Cancel training step). Shown on the booking, in the office's
-- "Training cancelled" alert, and later on the dashboard. No foreign keys. Run once in Supabase → SQL editor (after 039).
alter table bookings add column if not exists cancel_reason text;
alter table bookings add column if not exists cancel_note text;
alter table bookings add column if not exists cancelled_at timestamptz;
alter table bookings add column if not exists cancelled_by text;
notify pgrst, 'reload schema';
