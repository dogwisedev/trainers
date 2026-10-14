-- When the trainer was emailed about a new booking. The 10-minute check emails any booking that missed it
-- (e.g. the booking request timed out after saving).
-- Bookings older than a day count as done; ones made in the last 24 hours are emailed by the next check
-- (that's how today's missed bookings get their email).
-- Run once in Supabase → SQL editor (after 015).
alter table bookings add column if not exists notified_at timestamptz;
update bookings set notified_at = coalesce(created_at, now()) where notified_at is null and (created_at is null or created_at < now() - interval '1 day');
