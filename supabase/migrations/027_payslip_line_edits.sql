-- Payslips: hand edits are remembered line by line (not by freezing the whole payslip), so new bookings still appear.
-- skip_keys = automatic lines an admin deleted (they don't come back). Run once in Supabase → SQL editor (after 026).
alter table payslips add column if not exists skip_keys text[] not null default '{}';
