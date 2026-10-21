-- A payslip an admin has edited and saved is never rebuilt from the bookings again (edits used to snap back).
-- Run once in Supabase → SQL editor (after 025).
alter table payslips add column if not exists hand_edited boolean not null default false;
