-- Gusto people (from Gusto's contractor pay template): name, business and worker code only, never SSN/EIN digits.
-- Lets the app build the Gusto pay file without re-uploading the template each payday. Run once in Supabase → SQL editor (after 030).
create table if not exists gusto_payees (
  code text primary key,           -- Gusto worker_code
  first_name text,
  last_name text,
  business_name text,
  updated_at timestamptz not null default now()
);
alter table gusto_payees enable row level security;  -- server only
