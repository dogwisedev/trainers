-- 036: The client's personal "Before training" link (replaces the two HubSpot forms).
-- Answers go onto the client's own HubSpot contact (household + dog 1, as the forms did); dogs 2+ are kept here by name
-- until they're booked, then each booking picks up its dog's answers. Run once in Supabase → SQL editor (after 035).

create table if not exists form_dogs (
  contact_id text not null,           -- HubSpot contact id
  name_key text not null,             -- the dog's name, lower case, single spaces ("tuffy")
  name text not null,                 -- as typed ("Tuffy")
  answers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (contact_id, name_key)
);

-- Which dog's answers are on the HubSpot contact right now (dog 1), so they can follow the dog if sales reorders dog 1/2/3
create table if not exists form_contacts (
  contact_id text primary key,
  dog1_key text,
  names jsonb,                        -- dog names the client typed in, when HubSpot had none yet
  updated_at timestamptz not null default now()
);

alter table form_dogs enable row level security;
alter table form_contacts enable row level security;
