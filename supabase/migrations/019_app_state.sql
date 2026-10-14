-- Small key/value store for the app's own bookkeeping (e.g. the day the admin daily summary was last sent).
-- Run once in Supabase → SQL editor (after 018).
create table if not exists app_state (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table app_state enable row level security; -- server only
