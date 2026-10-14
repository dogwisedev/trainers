-- "OK to start": an admin is satisfied with what they have for a dog, so the client isn't asked for anything more.
-- Run once in Supabase → SQL editor (after 013).
alter table pretraining_dogs add column if not exists cleared_by text;
alter table pretraining_dogs add column if not exists cleared_at timestamptz;
