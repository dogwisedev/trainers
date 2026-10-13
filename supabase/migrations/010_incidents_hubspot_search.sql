-- Incidents that aren't about a chat (forms, bookings, HubSpot), the HubSpot date sync, and chat search.
-- Run once in Supabase → SQL editor (after 009).

-- ── Incidents: can point at a chat, a booking or a report ───────────────────
alter table chat_incidents alter column chat_id drop not null;
alter table chat_incidents add column if not exists booking_id uuid references bookings on delete set null;
alter table chat_incidents add column if not exists report_id uuid references reports on delete set null;
alter table chat_incidents add column if not exists ref text;   -- what it's about, e.g. 'deal:123', 'booking:<id>', 'report:<id>' (null = the chat)

do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'chat_incidents'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table chat_incidents drop constraint %I', c);
  end loop;
end $$;
alter table chat_incidents add constraint chat_incidents_kind_check check (kind in (
  'trainer_silent', 'client_waiting', 'client_pileup', 'ready_to_close', 'reopened',   -- chats
  'intake_media_missing', 'handover_photo_missing',                                   -- forms
  'overbooked', 'length_changed', 'booking_cancelled', 'hubspot_problem'               -- bookings / HubSpot
));

-- One live incident of each kind per thing (chat incidents keep working as before: ref is null, so it's per chat)
drop index if exists chat_incidents_one_live;
create unique index if not exists chat_incidents_one_live on chat_incidents ((coalesce(ref, chat_id::text)), kind) where status <> 'resolved';
create index if not exists chat_incidents_booking on chat_incidents (booking_id);

-- ── Bookings: when the dates were last checked against HubSpot ──────────────
alter table bookings add column if not exists hubspot_synced_at timestamptz;

-- ── Chat search: fast "contains" search on message text ────────────────────
create extension if not exists pg_trgm with schema extensions;   -- Supabase keeps extensions in their own schema
do $$ declare sch text; begin
  select n.nspname into sch from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists chat_messages_body_trgm on chat_messages using gin (body %I.gin_trgm_ops)', sch);
end $$;
