-- Weekly report cards and handover reports: trainers fill them in, an admin reviews, the client gets them once approved.
-- Run once in Supabase → SQL editor (after 005).

-- Client email (from HubSpot via "Book to…"), the Drive folder for the booking's media, and whether reports are expected.
alter table bookings add column if not exists client_email text;
alter table bookings add column if not exists drive_folder_id text;
alter table bookings add column if not exists drive_folder_url text;
-- Existing bookings stay OFF (so nobody gets a pile of overdue reports at launch); new bookings are ON.
alter table bookings add column if not exists reports_enabled boolean not null default false;
alter table bookings alter column reports_enabled set default true;

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings on delete cascade,
  trainer_id uuid not null references trainers on delete cascade,
  kind text not null check (kind in ('weekly', 'handover')),
  week_number int not null default 0,                       -- 0 for a handover report
  status text not null default 'draft' check (status in ('draft', 'submitted', 'changes_requested', 'approved')),
  answers jsonb not null default '{}',
  media jsonb not null default '[]',                        -- videos / photos stored in Google Drive
  due_by timestamptz,                                       -- deadline, for late checks and the deduction suggestion
  submitted_at timestamptz,
  review_note text,                                         -- admin's note when sending it back
  by_admin boolean not null default false,                  -- completed by an admin for the trainer
  approved_by uuid references auth.users on delete set null,
  approved_by_name text,
  approved_at timestamptz,
  sent_at timestamptz, sent_to text, send_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, kind, week_number)
);
create index if not exists reports_trainer on reports (trainer_id, status);
create index if not exists reports_status on reports (status, submitted_at);

drop trigger if exists reports_touch on reports;
create trigger reports_touch before update on reports for each row execute function touch_updated_at();

alter table reports enable row level security;

drop policy if exists reports_admin on reports;
create policy reports_admin on reports for all using (is_admin()) with check (is_admin());

drop policy if exists reports_trainer_read on reports;
create policy reports_trainer_read on reports for select using (trainer_id = my_trainer_id());

-- A trainer can start a report for their own booking, and edit it until an admin approves it.
drop policy if exists reports_trainer_insert on reports;
create policy reports_trainer_insert on reports for insert with check (
  trainer_id = my_trainer_id() and status = 'draft' and by_admin = false
  and exists (select 1 from bookings b where b.id = booking_id and b.trainer_id = my_trainer_id()));

drop policy if exists reports_trainer_update on reports;
create policy reports_trainer_update on reports for update
  using (trainer_id = my_trainer_id() and status in ('draft', 'changes_requested'))
  with check (trainer_id = my_trainer_id() and status in ('draft', 'submitted') and approved_at is null);
