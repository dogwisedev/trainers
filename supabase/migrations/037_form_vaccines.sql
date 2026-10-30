-- 037: Vaccine records sent from the client's before-training link before the dog is booked (Drive files, per dog).
-- When the dog is booked, its booking picks them up for the team to check. Run once in Supabase (after 036).
alter table form_dogs add column if not exists vaccines jsonb not null default '[]'::jsonb;
