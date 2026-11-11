-- 055: AI help for trainers and the office (all of it needs ANTHROPIC_API_KEY; switches on Pulse → Office).
--  app_settings     the switches and the form checklists (any admin can change them)
--  ai_form_checks   one row each time a submitted form is checked: "fits the standard" or what to check, and what the
--                   admin then did (approved, sent back, or approved by itself), so we can see how often it's right
--  reports.ai_draft the handover report the app drafted from the chat, kept beside what the trainer finally sent
--  ai_captions      update captions suggested to trainers in a dog's chat, and whether they were used
-- All server only (no policies). Run once (after 054).
create table if not exists app_settings (
  key text primary key, value jsonb not null, updated_by text, updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;

create table if not exists ai_form_checks (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null, kind text not null, trainer_id uuid,
  verdict text not null check (verdict in ('ok', 'check')),
  points jsonb not null default '[]',       -- [{ point, quote }]
  model text, created_at timestamptz not null default now(),
  outcome text check (outcome in ('approved', 'sent_back', 'auto')),  -- what happened next
  outcome_by text, outcome_at timestamptz, edited boolean              -- edited: the admin changed answers before approving
);
create index if not exists ai_form_checks_report on ai_form_checks (report_id, created_at desc);
alter table ai_form_checks enable row level security;

alter table reports add column if not exists ai_draft jsonb;

create table if not exists ai_captions (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid, chat_id uuid, words text, suggested text not null, final text, used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table ai_captions enable row level security;
notify pgrst, 'reload schema';
