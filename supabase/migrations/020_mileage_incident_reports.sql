-- Mileage pay and trainer incident reports. Run once in Supabase → SQL editor (after 019).

-- ── Mileage: per trainer, on their pay rates ──
-- Pay = (miles on the trip − free miles) × rate, per trip. e.g. 40 miles, paid over 20, $0.30 a mile = $6.00
alter table trainer_rates add column if not exists mileage_rate numeric(6,3);             -- $ per mile (blank = no mileage pay)
alter table trainer_rates add column if not exists mileage_free_miles numeric(7,1) not null default 0;  -- miles per trip before pay starts

-- Every trip a trainer drives: from the pickup (intake) and drop-off (handover) forms, and follow-up sessions.
-- Kept for pay and for the trainer's own records at tax time.
create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers on delete cascade,
  booking_id uuid references bookings on delete set null,
  report_id uuid unique references reports on delete set null,  -- the form it came from (pickup / drop-off)
  kind text not null check (kind in ('pickup', 'dropoff', 'followup')),
  trip_date date not null,
  miles numeric(7,1) not null check (miles >= 0 and miles <= 2000),
  notes text,                                                     -- route, or what was done in a follow-up session
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trips_trainer_date on trips (trainer_id, trip_date);
create index if not exists trips_booking on trips (booking_id);
alter table trips enable row level security;  -- server only

-- ── Incident reports from trainers (injury, escape, bite…) ──
create table if not exists incident_reports (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references chats on delete set null,
  booking_id uuid references bookings on delete set null,
  trainer_id uuid references trainers on delete set null,
  reported_by text not null,
  kind text not null,                 -- Injury, Escape, Bite (person), Fight or bite (dog), Illness or vet visit, Property damage, Other
  occurred_at timestamptz not null,
  what text not null,                 -- what happened
  action text,                        -- what was done
  vet boolean not null default false,
  vet_details text,
  client_told boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists incident_reports_booking on incident_reports (booking_id);
alter table incident_reports enable row level security;  -- server only

do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'chat_incidents'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table chat_incidents drop constraint %I', c);
  end loop;
end $$;
alter table chat_incidents add constraint chat_incidents_kind_check check (kind in (
  'trainer_silent', 'client_waiting', 'client_pileup', 'ready_to_close', 'reopened',
  'intake_media_missing', 'handover_photo_missing',
  'overbooked', 'length_changed', 'booking_cancelled', 'hubspot_problem',
  'not_ready', 'check_vaccines', 'trainer_report'
));
