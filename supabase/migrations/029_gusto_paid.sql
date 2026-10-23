-- Gusto list: record when a pay run was paid in Gusto, and by whom. Run once in Supabase → SQL editor (after 028).
alter table pay_runs add column if not exists gusto_paid_at timestamptz;
alter table pay_runs add column if not exists gusto_paid_by text;
