-- Sales tab and sales logins, deal payments (Stripe remaining-balance links), follow-up session pay, probation.
-- Run once in Supabase → SQL editor (after 020).

-- ── Sales people can sign in ──
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%' loop
    execute format('alter table profiles drop constraint %I', c);
  end loop;
end $$;
alter table profiles add constraint profiles_role_check check (role in ('admin', 'trainer', 'client', 'sales'));
alter table profiles add column if not exists hubspot_owner_id text;   -- a sales person's HubSpot user (deal owner)

-- ── Each booked deal's money, as last read from HubSpot (the cron refreshes it) ──
create table if not exists deal_money (
  deal_id text primary key,
  dealname text,
  owner_id text,                    -- HubSpot deal owner = the sales person
  amount numeric(10,2),             -- the sale (program price)
  amount_paid numeric(10,2),
  closed_on date,                   -- Closed Won date: the sale's month
  payment_status text,
  remaining_balance_link text,
  link_by_app boolean not null default false,   -- the app made the Stripe link (so it may close it once paid)
  followups date[] not null default '{}',       -- follow_up_session__1..3
  synced_at timestamptz
);
create index if not exists deal_money_closed on deal_money (closed_on);
alter table deal_money enable row level security;  -- server only

-- Sales before the app (October's from the Monies sheet), pasted in once by an admin
create table if not exists sales_import (
  id uuid primary key default gen_random_uuid(),
  month date not null,              -- first day of the month
  seller text not null,             -- name as on the sheet
  owner_id text,                    -- matched HubSpot owner, if found
  client text,
  program text,
  amount numeric(10,2) not null,
  paid_in_full boolean,
  created_at timestamptz not null default now()
);
alter table sales_import enable row level security;

-- Stripe payments already counted (a webhook can arrive twice)
create table if not exists stripe_payments (
  session_id text primary key,
  deal_id text,
  amount numeric(10,2),
  created_at timestamptz not null default now()
);
alter table stripe_payments enable row level security;

-- ── Follow-up sessions: the trainer's pay per session ──
alter table trainer_rates add column if not exists followup_rate numeric(8,2) not null default 60;

-- ── Probation (trainers added from now on) ──
-- on: program pay at 75%, the 25% held. approved: held money is paid in the next pay run. declined: still held, can be approved later.
alter table trainers add column if not exists probation text not null default 'none' check (probation in ('none', 'on', 'approved', 'declined'));
alter table trainers add column if not exists probation_decided_by text;
alter table trainers add column if not exists probation_decided_at timestamptz;
alter table trainers add column if not exists probation_release_run date;     -- pay run (submit date) that pays the held 25%
alter table trainers add column if not exists probation_release_amount numeric(10,2);
