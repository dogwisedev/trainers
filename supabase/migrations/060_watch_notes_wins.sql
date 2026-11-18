-- 060: What the Tower's prompt used to carry, now in the app.
--  watch_list    dogs the office is keeping an eye on: why, who, since when. Shown in the office brief with what's
--                happened since, and on the dog page. Ends when someone stops watching (or 7 days after the dog goes home).
--  client_notes  standing notes about a client everyone should know ("uses his own e-collar", "no crate when out"), on
--                the dog page; office-only notes are hidden from the trainer.
--  message_needs.praise  a client message praising the trainer or the progress: counted as a win (Pulse, the brief).
-- Server only. Run once (after 059).
create table if not exists watch_list (
  booking_id uuid primary key, reason text not null, note text, by text, at timestamptz not null default now()
);
alter table watch_list enable row level security;
create table if not exists client_notes (
  id uuid primary key default gen_random_uuid(), deal_key text not null, text text not null,
  office_only boolean not null default false, by text, role text, at timestamptz not null default now()
);
create index if not exists client_notes_deal on client_notes (deal_key, at desc);
alter table client_notes enable row level security;
alter table message_needs add column if not exists praise boolean;
notify pgrst, 'reload schema';
