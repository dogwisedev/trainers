-- Before-training checklist: the client's form answers (from HubSpot), per dog, and the vaccine review.
-- Run once in Supabase → SQL editor (after 011).
--
-- HubSpot stays the source of truth for the client's answers (contact properties) and the checklist (deal properties).
-- A contact holds ONE dog's answers, so: dog 1 (k9___dog_name) lives in the contact properties,
-- dogs 2 to 4 (dog_2_name…) live here, in pretraining_dogs.answers.

create table if not exists pretraining_deals (
  deal_id text primary key,                       -- HubSpot deal id (= chats.deal_key, bookings.hubspot_deal_id)
  contact_id text,                                -- the deal's contact in HubSpot
  deal jsonb not null default '{}'::jsonb,        -- deal properties as last read (dog names, how many dogs, balance link, checklist)
  contact jsonb not null default '{}'::jsonb,     -- contact properties as last read (form answers: household + dog 1)
  pending jsonb not null default '{}'::jsonb,     -- answers saved in the app that HubSpot hasn't accepted yet (retried by the cron)
  synced_at timestamptz,
  sync_error text,
  updated_at timestamptz not null default now()
);

create table if not exists pretraining_dogs (
  booking_id uuid primary key references bookings on delete cascade,
  deal_id text not null,
  slot int not null default 1 check (slot between 1 and 4),   -- 1 = k9___dog_name, 2 = dog_2_name, 3 = dog_3_name, 4 = dog_4_name
  slot_set_by text,                                           -- set by an admin (otherwise matched by name)
  answers jsonb not null default '{}'::jsonb,                 -- dogs 2 to 4 only (dog 1's answers are the contact properties)
  vaccines jsonb not null default '{}'::jsonb,                -- { status: ok|missing|review, missing: [], files: [], reviewedBy, reviewedAt, note }
  changes jsonb not null default '{}'::jsonb,                 -- last change per answer: { key: { by, role, at } }
  updated_at timestamptz not null default now()
);
create index if not exists pretraining_dogs_deal on pretraining_dogs (deal_id);

-- Only the server touches these (it checks who's asking first)
alter table pretraining_deals enable row level security;
alter table pretraining_dogs enable row level security;

-- New incident: dog not ready a week before training
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'chat_incidents'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table chat_incidents drop constraint %I', c);
  end loop;
end $$;
alter table chat_incidents add constraint chat_incidents_kind_check check (kind in (
  'trainer_silent', 'client_waiting', 'client_pileup', 'ready_to_close', 'reopened',
  'intake_media_missing', 'handover_photo_missing',
  'overbooked', 'length_changed', 'booking_cancelled', 'hubspot_problem',
  'not_ready'
));
