-- DogwiseTrainers schema. Run once in Supabase → SQL editor, then run seed.sql.
create extension if not exists pgcrypto;

-- ── Tables ────────────────────────────────────────────────────────────────
create table if not exists trainers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text, work_email text, dogwise_email text, phone text,
  address text, city text, state text, zip text, lat double precision, lon double precision,
  range_text text, range_miles int not null default 100,
  capacity int not null default 2 check (capacity between 0 and 30),   -- dogs at one time
  monthly_capacity int,
  programs text, offering text, notes text, poc text,
  shirt_size text, second_location text, local_vet text, emergency_vet text, emergency_contact text,
  birthday date, bio text, photo_url text,
  active boolean not null default true,
  data_flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  role text not null check (role in ('admin', 'trainer')),
  trainer_id uuid references trainers on delete set null,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers on delete cascade,
  client_name text not null,
  dog_name text,
  program text,
  start_date date not null,
  end_date date not null,
  weeks int,
  status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'in_training', 'completed', 'cancelled')),
  notes text,
  hubspot_deal_id text,
  source text,                              -- e.g. 'sales-extension'
  sheet_color text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists time_off (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers on delete cascade,
  start_date date not null,
  end_date date not null,
  slots_blocked int check (slots_blocked is null or slots_blocked > 0),  -- null = whole calendar blocked
  reason text not null default 'Holiday',
  note text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers on delete cascade,   -- the thread
  sender_id uuid references auth.users on delete set null,
  sender_role text not null check (sender_role in ('admin', 'trainer')),
  sender_name text,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists bookings_trainer_dates on bookings (trainer_id, start_date, end_date);
create index if not exists time_off_trainer_dates on time_off (trainer_id, start_date, end_date);
create index if not exists messages_thread on messages (trainer_id, created_at);
create index if not exists bookings_hubspot_deal on bookings (hubspot_deal_id);

-- ── Helpers ───────────────────────────────────────────────────────────────
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function my_trainer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select trainer_id from profiles where id = auth.uid() and role = 'trainer'
$$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trainers_touch on trainers;
create trigger trainers_touch before update on trainers for each row execute function touch_updated_at();
drop trigger if exists bookings_touch on bookings;
create trigger bookings_touch before update on bookings for each row execute function touch_updated_at();

-- Trainers can edit their own contact details, never capacity, status, range or admin notes.
create or replace function protect_trainer_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_admin() or auth.uid() is null then return new; end if;
  new.name := old.name; new.email := old.email; new.dogwise_email := old.dogwise_email;
  new.capacity := old.capacity; new.monthly_capacity := old.monthly_capacity; new.active := old.active;
  new.range_miles := old.range_miles; new.range_text := old.range_text;
  new.programs := old.programs; new.offering := old.offering; new.notes := old.notes; new.poc := old.poc;
  new.zip := old.zip; new.lat := old.lat; new.lon := old.lon; new.city := old.city; new.state := old.state;
  if new.address is distinct from old.address then
    new.data_flags := array_append(old.data_flags, 'Address changed by trainer: update ZIP / map pin');
  else
    new.data_flags := old.data_flags;
  end if;
  return new;
end $$;
drop trigger if exists trainers_protect on trainers;
create trigger trainers_protect before update on trainers for each row execute function protect_trainer_fields();

-- ── Row level security ────────────────────────────────────────────────────
alter table trainers enable row level security;
alter table profiles enable row level security;
alter table bookings enable row level security;
alter table time_off enable row level security;
alter table messages enable row level security;

drop policy if exists trainers_read on trainers;
create policy trainers_read on trainers for select using (is_admin() or id = my_trainer_id());
drop policy if exists trainers_admin_write on trainers;
create policy trainers_admin_write on trainers for all using (is_admin()) with check (is_admin());
drop policy if exists trainers_self_update on trainers;
create policy trainers_self_update on trainers for update using (id = my_trainer_id()) with check (id = my_trainer_id());

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select using (id = auth.uid() or is_admin());
drop policy if exists profiles_admin on profiles;
create policy profiles_admin on profiles for all using (is_admin()) with check (is_admin());

drop policy if exists bookings_read on bookings;
create policy bookings_read on bookings for select using (is_admin() or trainer_id = my_trainer_id());
drop policy if exists bookings_admin on bookings;
create policy bookings_admin on bookings for all using (is_admin()) with check (is_admin());

drop policy if exists time_off_rw on time_off;
create policy time_off_rw on time_off for all
  using (is_admin() or trainer_id = my_trainer_id())
  with check (is_admin() or trainer_id = my_trainer_id());

drop policy if exists messages_read on messages;
create policy messages_read on messages for select using (is_admin() or trainer_id = my_trainer_id());
drop policy if exists messages_send on messages;
create policy messages_send on messages for insert with check (
  sender_id = auth.uid() and (
    (is_admin() and sender_role = 'admin') or
    (trainer_id = my_trainer_id() and sender_role = 'trainer')
  ));
drop policy if exists messages_mark_read on messages;
create policy messages_mark_read on messages for update using (is_admin() or trainer_id = my_trainer_id());

-- Live chat
do $$ begin
  alter publication supabase_realtime add table messages;
exception when others then null; end $$;
