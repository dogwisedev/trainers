-- Report types: Intake form (pickup day), Weekly Health Check (Wed to Fri), Handover report (end of program).
-- Plus "your form is open / due today" reminders to trainers, sent once each.
-- Run once in Supabase → SQL editor (after 008).

do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'reports'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table reports drop constraint %I', c);
  end loop;
end $$;
alter table reports add constraint reports_kind_check check (kind in ('intake', 'weekly', 'handover'));

create table if not exists report_reminders (
  booking_id uuid not null references bookings on delete cascade,
  kind text not null,
  week_number int not null default 0,
  stage text not null check (stage in ('open', 'due')),
  sent_at timestamptz not null default now(),
  primary key (booking_id, kind, week_number, stage)
);
alter table report_reminders enable row level security;
drop policy if exists report_reminders_admin on report_reminders;
create policy report_reminders_admin on report_reminders for all using (is_admin()) with check (is_admin());
