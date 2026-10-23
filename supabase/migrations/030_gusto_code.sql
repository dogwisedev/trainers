-- Each trainer's Gusto worker code (the "worker_code" column in Gusto's contractor pay template), to fill the Gusto file.
-- Run once in Supabase → SQL editor (after 029).
alter table trainers add column if not exists gusto_code text;
