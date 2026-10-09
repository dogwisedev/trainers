-- Rates are WEEKLY amounts (agreed with Sean). Bookings can run extra days past their last full week.
-- Run once in Supabase → SQL editor (after 003_payroll.sql).
alter table bookings add column if not exists extra_days int not null default 0 check (extra_days between 0 and 13);
alter table payslip_lines add column if not exists days int;   -- extra days paid on this line
comment on column trainer_rates.w2 is 'Weekly rate, 2-week program';
comment on column trainer_rates.w3 is 'Weekly rate, 3-week program';
comment on column trainer_rates.w4 is 'Weekly rate, 4-week program';
comment on column trainer_rates.w4_rehab is 'Weekly rate, 4-week rehab';
comment on column trainer_rates.w5_rehab is 'Weekly rate, 5-week rehab';
comment on column trainer_rates.w6_rehab is 'Weekly rate, 6-week rehab (also 7 and 8 weeks)';
