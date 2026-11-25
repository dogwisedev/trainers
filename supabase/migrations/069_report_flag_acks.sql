-- 069: A flagged form can't be approved until each flag is acknowledged. One row per flag: what was flagged (by the app's
-- check, or a health answer that isn't "all fine"), who acknowledged it, when, and what they did about it. Of 94 weekly
-- health checks, 34 were flagged and simply approved; this is the record that someone looked. Server only (no policies).
-- Run once (after 068). Safe to run again.
create table if not exists report_flag_acks (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  booking_id uuid, trainer_id uuid,
  source text not null check (source in ('ai', 'health')),
  flag text not null, quote text,
  note text not null,                       -- what the person approving did about it
  by_user uuid, by_name text not null,
  at timestamptz not null default now()
);
create index if not exists report_flag_acks_report on report_flag_acks (report_id, at desc);
alter table report_flag_acks enable row level security;
notify pgrst, 'reload schema';
