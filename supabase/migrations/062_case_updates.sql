-- 062: The rest of the Tower in the app.
--  case_updates  the team's update on a client's case, written on the dog page: logged word for word as a note on the
--                HubSpot deal straight away, with the actions taken (ticket closed, follow-up declined, session booked)
--                and whether it needs Sean. Replaces replying to the QA daily email. The QA daily is built from these.
-- Server only. Run once (after 061).
create table if not exists case_updates (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null, booking_id uuid, client text, dog text,
  text text not null, by text, note_id text,
  actions jsonb not null default '[]',    -- [{ what, object, objectId }]
  for_sean boolean not null default false, settled_at timestamptz,
  at timestamptz not null default now()
);
create index if not exists case_updates_at on case_updates (at desc);
create index if not exists case_updates_deal on case_updates (deal_id, at desc);
alter table case_updates enable row level security;
notify pgrst, 'reload schema';
