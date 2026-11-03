-- 044: Follow-ups, two details (after 043).
--  · A missed session can be booked again: only requested / confirmed / done ones hold their session number.
--  · The one-time "your program includes 3 follow-up sessions" message after the handover is sent once per chat.
-- Run once in Supabase → SQL editor.
drop index if exists followups_one_live;
create unique index if not exists followups_one_live on followups (booking_id, n) where status in ('requested', 'confirmed', 'done');
alter table chats add column if not exists followup_nudged_at timestamptz;
notify pgrst, 'reload schema';
