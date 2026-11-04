-- 048: Assign or Ask (OPS 08). Each trainer gets a status (Active / Watch / Hold, set by Pedro) and the programs they take
-- (ticks of HubSpot's program names); each booking records its lane; offers and "Ask Pedro" requests are tracked.
-- Run once in Supabase → SQL editor (after 047).
alter table trainers add column if not exists status_board text not null default 'active';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trainers_status_board_check') then
    alter table trainers add constraint trainers_status_board_check check (status_board in ('active', 'watch', 'hold'));
  end if;
end $$;
alter table trainers add column if not exists program_types text[] not null default '{}';  -- empty = takes every program
alter table bookings add column if not exists lane text;             -- assign | offer | pedro (how it was booked)
alter table bookings add column if not exists lane_reasons text;

create table if not exists booking_asks (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null,
  trainer_id uuid not null,
  kind text not null check (kind in ('offer', 'pedro')),     -- offer: the POC checks with the trainer; pedro: Pedro decides
  reasons text[] not null default '{}',
  detail text,                                               -- what was known when asked: dog, program, dates, distance…
  deadline timestamptz,
  status text not null default 'open' check (status in ('open', 'yes', 'no', 'expired', 'approved', 'elsewhere', 'standby', 'escalated')),
  note text, requested_by text, created_at timestamptz not null default now(),
  answered_by text, answered_at timestamptz
);
create index if not exists booking_asks_deal on booking_asks (deal_id);
alter table booking_asks enable row level security;  -- server only

do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'chat_incidents'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table chat_incidents drop constraint %I', c);
  end loop;
end $$;
alter table chat_incidents add constraint chat_incidents_kind_check check (kind in (
  'trainer_silent', 'client_waiting', 'client_pileup', 'ready_to_close', 'reopened',
  'intake_media_missing', 'handover_photo_missing',
  'overbooked', 'length_changed', 'booking_cancelled', 'hubspot_problem',
  'not_ready', 'check_vaccines', 'trainer_report', 'deal_not_booked',
  'standby_reminder', 'followup_request', 'followup_report',
  'pickup_unconfirmed', 'dropoff_unconfirmed',
  'trainer_offer', 'ask_pedro'
));
notify pgrst, 'reload schema';
