-- 051: Each admin's own Quo number (Your account → Your Quo number). Texts to a trainer come from the number of the admin
-- who is that trainer's Point of Contact (quo_poc = the POC name as it's written on trainer profiles), so the trainer's
-- replies land in that admin's Quo inbox. Anyone else's come from QUO_FROM. Run once (after 050).
alter table profiles add column if not exists quo_number text;   -- a Quo number ID (PN…) or +1XXXXXXXXXX
alter table profiles add column if not exists quo_poc text;      -- e.g. "Anita": trainers with this POC are texted from quo_number
notify pgrst, 'reload schema';
