-- 035: Training materials sent in each dog's chat during the program (and after drop-off), set up by admins.
-- Run once in Supabase → SQL editor (after 034). Safe to run twice.

-- Each item: a Google Drive video or PDF, its own message, and its place in a program's list.
-- plan = one of the 7 programs (as named in the app), or 'after' (after drop-off).
create table if not exists training_materials (
  id uuid primary key default gen_random_uuid(),
  plan text not null,
  position int not null,
  title text not null,
  message text,
  drive_id text not null,
  kind text not null default 'video' check (kind in ('video', 'file', 'photo')),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists training_materials_plan on training_materials (plan, position) where active;

-- Each list's pace. Programs: the day Item 1 goes out (Day 1 = pickup). After drop-off: start N days after, then every N days.
create table if not exists training_plans (
  plan text primary key,
  first_day int not null default 2 check (first_day >= 1),
  start_after int not null default 2 check (start_after >= 0),
  every_days int not null default 4 check (every_days >= 1),
  updated_at timestamptz not null default now()
);

-- What each dog's chat was sent (or skipped), one row per item, so nothing is ever sent twice.
-- deal_key = the chat's key (the HubSpot deal), so two dogs on one deal share one schedule.
create table if not exists training_sends (
  id uuid primary key default gen_random_uuid(),
  deal_key text not null,
  booking_id uuid references bookings on delete set null,
  material_id uuid references training_materials on delete set null,
  plan text not null,
  position int not null,
  status text not null check (status in ('sent', 'skipped', 'failed')),
  planned_on date,
  chat_id uuid references chats on delete set null,
  message_id uuid,
  note text,
  at timestamptz not null default now(),
  unique (deal_key, material_id)
);
create index if not exists training_sends_deal on training_sends (deal_key, at desc);

-- Per dog: pause the materials, and the program an admin picked when the booking's own name isn't clear ("4-week")
alter table bookings add column if not exists training_paused boolean not null default false;
alter table bookings add column if not exists program_choice text;

-- Server only (the app reads and writes these with its own key)
alter table training_materials enable row level security;
alter table training_plans enable row level security;
alter table training_sends enable row level security;

-- The intro that goes with the first item each client gets (editable on the Training materials page)
insert into app_state (key, value) values ('training_intro',
  'Hey! As training goes on, we''ll share short videos to help you get ready for training at home.')
on conflict (key) do nothing;
