-- 032: Activity log outcomes, tamper-proof messages, "Closed Won, not booked" to-dos, file previews.
-- Run once in Supabase → SQL editor (after 031). Safe to run twice.

-- ── 1. Activity log: did the action actually work? ─────────────────────────
alter table audit_log add column if not exists ok boolean;      -- null = just a note (sign-ins, system), true = done, false = failed or refused
alter table audit_log add column if not exists error text;      -- why it failed, in the app's words
create index if not exists audit_log_failed on audit_log (at desc) where ok = false;

-- ── 2. Chat messages: the database stamps the time, and nobody deletes from a browser ──
-- Before: a signed-in person could send a message with any created_at (back-dating it).
create or replace function chat_messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if auth.uid() is null then return new; end if;            -- the server (service role) writes system messages itself
  who := chat_access(new.chat_id);
  if who is null then raise exception 'not allowed to write in this chat'; end if;
  if not exists (select 1 from chats where id = new.chat_id and status = 'open') then raise exception 'this chat is closed'; end if;
  new.sender_id := auth.uid();
  new.sender_role := who;
  new.created_at := now();                                   -- never trust the phone's clock or a back-dated message
  new.kind := case when new.kind in ('text', 'media') then new.kind else 'text' end;
  new.body := left(new.body, 4000);
  new.report_id := null;
  new.sender_name := case who
    when 'admin' then 'Dogwise team'
    when 'trainer' then (select name from trainers where id = my_trainer_id())
    else (select client_name from chats where id = new.chat_id) end;
  return new;
end $$;

-- Closed chats are still archived by the server (service role); admins can no longer delete messages from a browser.
drop policy if exists chat_messages_admin_delete on chat_messages;

-- Chat list preview says "Sent a file" for PDFs
create or replace function chat_messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update chats set
    last_message_at = new.created_at,
    last_preview = left(coalesce(nullif(new.body, ''), case
      when new.kind = 'media' and new.media -> 0 ->> 'kind' = 'file' then 'Sent a file'
      when new.kind = 'media' then 'Sent a photo or video'
      when new.kind = 'report' then 'Report' else '' end), 90),
    last_sender = new.sender_role,
    last_trainer_at = case when new.sender_role = 'trainer' then new.created_at else last_trainer_at end,
    last_client_at = case when new.sender_role = 'client' then new.created_at else last_client_at end,
    last_admin_at = case when new.sender_role = 'admin' then new.created_at else last_admin_at end
  where id = new.chat_id;
  return new;
end $$;

-- ── 3. Trainer ↔ team messages: can be marked read, never rewritten ─────────
-- Before: the "mark read" rule let a signed-in trainer change any column (including the team's replies).
revoke update on messages from anon, authenticated;
grant update (read_at) on messages to authenticated;

create or replace function messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;            -- server writes (system notes) are trusted
  new.created_at := now();
  new.read_at := null;
  if new.sender_role = 'trainer' then new.sender_name := (select name from trainers where id = my_trainer_id()); end if;
  return new;
end $$;
drop trigger if exists messages_bi on messages;
create trigger messages_bi before insert on messages for each row execute function messages_before_insert();

-- ── 4. New to-do: a Closed Won deal in HubSpot with no booking in the app ───
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'chat_incidents'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table chat_incidents drop constraint %I', c);
  end loop;
end $$;
alter table chat_incidents add constraint chat_incidents_kind_check check (kind in (
  'trainer_silent', 'client_waiting', 'client_pileup', 'ready_to_close', 'reopened',
  'intake_media_missing', 'handover_photo_missing',
  'overbooked', 'length_changed', 'booking_cancelled', 'hubspot_problem',
  'not_ready', 'check_vaccines', 'trainer_report', 'deal_not_booked'
));
