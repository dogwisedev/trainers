-- Activity log: every action anyone takes in the app (who, what, when). Only alma@dogwiseacademy.com can see it.
-- Run once in Supabase → SQL editor (after 023).
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  who text,
  role text,
  action text not null,
  detail text,
  link text
);
create index if not exists audit_log_at on audit_log (at desc);
alter table audit_log enable row level security;  -- server only
