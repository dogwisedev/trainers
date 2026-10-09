-- Payroll: private pay rates, pay runs every other Monday, payslips with lines.
-- Run once in Supabase → SQL editor.

-- Rehab programs pay differently
alter table bookings add column if not exists rehab boolean not null default false;
update bookings set rehab = true where rehab = false and (program ~* 'rehab' or program ~* '\mRR\M');

-- What each trainer earns PER WEEK for each program type (agreed by Sean). Admins only: trainers never see this table.
create table if not exists trainer_rates (
  trainer_id uuid primary key references trainers on delete cascade,
  w2 numeric(10,2),         -- weekly rate, 2-week program
  w3 numeric(10,2),         -- 3 weeks
  w4 numeric(10,2),         -- 4 weeks
  w4_rehab numeric(10,2),   -- 4 weeks rehab
  w5_rehab numeric(10,2),   -- 5 weeks rehab
  w6_rehab numeric(10,2),   -- 6 weeks rehab (7 and 8 weeks use it too)
  report_deduction numeric(10,2) not null default 100,  -- full deduction for a missed weekly or handover report
  updated_at timestamptz not null default now()
);

-- One pay run per submission Monday (paid that Friday). Covers two program weeks.
create table if not exists pay_runs (
  id uuid primary key default gen_random_uuid(),
  submit_date date not null unique,
  period_start date not null,
  period_end date not null,
  paid_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists payslips (
  id uuid primary key default gen_random_uuid(),
  pay_run_id uuid not null references pay_runs on delete cascade,
  trainer_id uuid not null references trainers on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  adjustments numeric(10,2) not null default 0,
  notes text,
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  trainer_name text,
  trainer_address text,
  approved_by uuid references auth.users on delete set null,
  approved_by_name text,
  approved_at timestamptz,
  sent_at timestamptz,
  sent_to text,
  send_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pay_run_id, trainer_id)
);

create table if not exists payslip_lines (
  id uuid primary key default gen_random_uuid(),
  payslip_id uuid not null references payslips on delete cascade,
  kind text not null check (kind in ('training', 'route', 'deduction', 'other')),
  booking_id uuid references bookings on delete set null,
  weeks_completed int,
  week_from int,                 -- program week this line starts at (1-based)
  pct int,                       -- deductions: % of the full deduction
  client text, dog text, program text, description text,
  amount numeric(10,2) not null default 0,
  auto boolean not null default false,   -- built from bookings; rebuilt with the draft
  sort int not null default 0
);
create index if not exists payslip_lines_slip on payslip_lines (payslip_id, sort);

drop trigger if exists payslips_touch on payslips;
create trigger payslips_touch before update on payslips for each row execute function touch_updated_at();

alter table trainer_rates enable row level security;
alter table pay_runs enable row level security;
alter table payslips enable row level security;
alter table payslip_lines enable row level security;

drop policy if exists rates_admin on trainer_rates;
create policy rates_admin on trainer_rates for all using (is_admin()) with check (is_admin());

drop policy if exists runs_admin on pay_runs;
create policy runs_admin on pay_runs for all using (is_admin()) with check (is_admin());
drop policy if exists runs_trainer_read on pay_runs;
create policy runs_trainer_read on pay_runs for select using (my_trainer_id() is not null);

drop policy if exists slips_admin on payslips;
create policy slips_admin on payslips for all using (is_admin()) with check (is_admin());
drop policy if exists slips_trainer_read on payslips;
create policy slips_trainer_read on payslips for select using (trainer_id = my_trainer_id() and status = 'approved');

drop policy if exists lines_admin on payslip_lines;
create policy lines_admin on payslip_lines for all using (is_admin()) with check (is_admin());
drop policy if exists lines_trainer_read on payslip_lines;
create policy lines_trainer_read on payslip_lines for select using (
  exists (select 1 from payslips p where p.id = payslip_id and p.trainer_id = my_trainer_id() and p.status = 'approved'));
