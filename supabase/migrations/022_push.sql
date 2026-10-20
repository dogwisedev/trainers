-- Phone notifications (web push): one row per phone or browser that turned them on.
-- Run once in Supabase → SQL editor (after 021).
create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subscriptions_user on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;  -- server only
