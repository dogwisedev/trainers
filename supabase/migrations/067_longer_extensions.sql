-- 067: Extensions up to 6 weeks past the program (it was 13 days; Jax and Milo were extended by 14 and the HubSpot sync
-- stopped on them). Run once (after 066). Safe to run again.
alter table bookings drop constraint if exists bookings_extra_days_check;
alter table bookings add constraint bookings_extra_days_check check (extra_days between 0 and 42);
