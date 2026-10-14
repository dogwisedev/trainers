-- When a trainer who hasn't signed in yet was last sent the friendly "here's how to get in" email.
-- Run once in Supabase → SQL editor (after 016).
alter table trainers add column if not exists signin_nudged_at timestamptz;
