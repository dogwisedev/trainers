-- 068: Parking a To do item: "I've done my bit, check back in…". The item moves to Waiting, comes back by itself when the
-- time is up (saying what was done), and disappears if the other person acts first. Three parks at most, the third marked
-- as the last; then it's acted on or passed to Pedro. Every park is kept, so it's also the record of what the office did.
-- Server only. Run once (after 067).
create table if not exists todo_parks (
  id uuid primary key default gen_random_uuid(),
  item_key text not null,                 -- the To do item ("inc:<id>", "pattern:<chat>"…)
  did text not null,                      -- what they did: "Called the trainer", "Asked Sean"…
  until timestamptz,                      -- back on To do at this time (null for a pass)
  passed boolean not null default false,  -- passed to Pedro: no more parking
  trainer_id uuid, by text, at timestamptz not null default now()
);
create index if not exists todo_parks_key on todo_parks (item_key, at desc);
alter table todo_parks enable row level security;
notify pgrst, 'reload schema';
