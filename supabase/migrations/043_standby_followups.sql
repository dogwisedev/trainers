-- 043: Standby (Closed Won deals parked, and postponed trainings) and follow-up sessions booked through the app.
-- No foreign keys on standby (it's keyed by the HubSpot deal). Run once in Supabase → SQL editor (after 042).

create table if not exists standby (
  deal_id text primary key,                 -- the HubSpot deal
  source text not null default 'deal',      -- 'deal' (Closed Won, never booked) or 'postponed' (a booking postponed)
  booking_id uuid,                          -- the postponed booking, if any
  note text,
  remind_on date,                           -- a To do comes back on this day (null = just keep it on the Standby list)
  reminded_at timestamptz,
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table standby enable row level security;  -- server only

-- Follow-up sessions: asked for by the client in the chat, or set up by the trainer; then a short report afterwards
create table if not exists followups (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings on delete cascade,
  chat_id uuid,
  n int not null check (n between 1 and 3),            -- session 1, 2 or 3 (follow_up_session__n in HubSpot)
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'done', 'missed', 'cancelled')),
  requested_by text,                                    -- 'client', 'trainer' or 'admin'
  options jsonb not null default '[]',                  -- the client's preferred days and times: [{ day, part }]
  note text,
  at timestamptz,                                       -- the confirmed date and time
  reminder_id uuid,                                     -- the scheduled "see you tomorrow" message
  completed boolean, duration_min int, comments text, reported_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists followups_booking on followups (booking_id);
create unique index if not exists followups_one_live on followups (booking_id, n) where status <> 'cancelled';
alter table followups enable row level security;  -- server only

-- New To do kinds: a standby reminder, a follow-up waiting for the trainer, a follow-up report due
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
  'standby_reminder', 'followup_request', 'followup_report'
));
notify pgrst, 'reload schema';
