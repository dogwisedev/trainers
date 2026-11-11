-- 057: AI vaccine checks. When a dog's vaccine records are uploaded in the app, Claude reads them for Rabies, Bordetella
-- and the distemper combo (DHPP, DHLPP and its other names), each valid through the last day of the stay, and says "all in
-- order", what's missing or expired, or "check by hand". A person still confirms (All OK / Save as missing); what they
-- decided is kept beside what the app said, so Pulse → Office shows how often it's right. Server only.
-- Run once (after 056).
create table if not exists ai_vaccine_checks (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  verdict text not null check (verdict in ('ok', 'missing', 'unclear')),
  missing text[] not null default '{}',     -- DHLPP, Bordetella, Rabies
  lines jsonb not null default '[]',        -- [{ vaccine, status, given, validUntil, note }]
  note text, files int, model text,
  created_at timestamptz not null default now(),
  outcome text check (outcome in ('ok', 'missing')),   -- what the admin decided
  outcome_missing text[], agreed boolean, outcome_by text, outcome_at timestamptz
);
create index if not exists ai_vaccine_checks_booking on ai_vaccine_checks (booking_id, created_at desc);
alter table ai_vaccine_checks enable row level security;
notify pgrst, 'reload schema';
