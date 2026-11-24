-- 066: Before a trainer sends a form, the app tells them what's missing ("You said yes to skin, but not where or since
-- when"). Each look is kept, and what happened next: right first time, fixed after a nudge, or sent anyway. That's how we
-- see whether the nudges teach. Server only. Run once (after 065).
create table if not exists form_coaching (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null, trainer_id uuid, kind text not null,
  round int not null default 1,                    -- 1 = the first try at sending, 2 = after fixing, …
  tips jsonb not null default '[]',
  outcome text check (outcome in ('first_time', 'fixed', 'sent_anyway')),
  at timestamptz not null default now()
);
create index if not exists form_coaching_report on form_coaching (report_id, at desc);
create index if not exists form_coaching_at on form_coaching (at desc);
alter table form_coaching enable row level security;
notify pgrst, 'reload schema';
