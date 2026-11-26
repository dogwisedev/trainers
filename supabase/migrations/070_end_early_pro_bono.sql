-- 070: Ending a stay early, and pro bono days. Run once (after 069). Safe to run again.
--  left_on      the day the dog left the trainer, when a training was cancelled mid-program or finished early
--  end_kind     which of the two it was
--  end_pay      what the admin chose: 'days' = pay the trainer for the days the dog was with them, 'none' = no payment
--  unpaid_days  pro bono days at the end of the stay (an extension the trainer gave for free): the dog is tracked and the
--               kennel is taken, but those days aren't on the payslip
alter table bookings add column if not exists left_on date;
alter table bookings add column if not exists end_kind text;
alter table bookings add column if not exists end_pay text;
alter table bookings add column if not exists unpaid_days integer not null default 0;
alter table bookings add column if not exists ended_by text;
alter table bookings add column if not exists ended_at timestamptz;
alter table bookings drop constraint if exists bookings_end_kind_check;
alter table bookings add constraint bookings_end_kind_check check (end_kind is null or end_kind in ('cancelled_mid', 'finished_early'));
alter table bookings drop constraint if exists bookings_end_pay_check;
alter table bookings add constraint bookings_end_pay_check check (end_pay is null or end_pay in ('days', 'none'));
alter table bookings drop constraint if exists bookings_unpaid_days_check;
alter table bookings add constraint bookings_unpaid_days_check check (unpaid_days between 0 and 42);
notify pgrst, 'reload schema';
