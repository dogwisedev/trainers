-- 054: "Missed (late)" for a form: no longer needed (the next week's check is in, or it's too late to matter), but it stays
-- on record as late, for the deduction. It leaves the trainer's list and reminders like "not needed" does, shows as missing
-- on the program strip and in HubSpot, and is listed on the trainer's payslip until someone ticks "Deducted".
-- Run once (after 053).
alter table reports drop constraint if exists reports_status_check;
alter table reports add constraint reports_status_check check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'waived', 'missed'));
alter table reports add column if not exists deducted_at timestamptz;
alter table reports add column if not exists deducted_by text;
notify pgrst, 'reload schema';
