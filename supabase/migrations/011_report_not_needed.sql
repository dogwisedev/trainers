-- Forms an admin marks as "not needed" (made by mistake, wrong dates, dog not in care that week).
-- They drop off every to-do list, reminder and late count. An admin can bring one back.
-- Run once in Supabase → SQL editor (after 010).
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'reports'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table reports drop constraint %I', c);
  end loop;
end $$;
alter table reports add constraint reports_status_check check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'waived'));
alter table reports add column if not exists waived_by text;
alter table reports add column if not exists waived_at timestamptz;
