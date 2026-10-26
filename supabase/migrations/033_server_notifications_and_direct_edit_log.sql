-- 033: Chat notifications sent by the server (not the sender's phone), and a database log of changes made outside the app.
-- Run once in Supabase → SQL editor (after 032). Safe to run twice. Nothing to set up by hand afterwards:
-- the app registers its own address on its next 10-minute chat check.

-- ── 1. Every chat message is notified exactly once, by the server ──────────
alter table chat_messages add column if not exists notified_at timestamptz;
update chat_messages set notified_at = created_at where notified_at is null;   -- everything already in the app counts as notified
create index if not exists chat_messages_unnotified on chat_messages (created_at) where notified_at is null;

-- Same as 032, plus: a sender can't mark their own message "notified" (which would silence it)
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
  new.created_at := now();
  new.notified_at := null;
  new.kind := case when new.kind in ('text', 'media') then new.kind else 'text' end;
  new.body := left(new.body, 4000);
  new.report_id := null;
  new.sender_name := case who
    when 'admin' then 'Dogwise team'
    when 'trainer' then (select name from trainers where id = my_trainer_id())
    else (select client_name from chats where id = new.chat_id) end;
  return new;
end $$;

-- The key the database uses to call the app (app_state is server-only: browsers can't read it)
insert into app_state (key, value) values ('notify_secret', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- pg_net lets the database call the app the moment a message is saved
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net is not available: the 10-minute check will send chat notifications instead';
end $$;

create or replace function chat_messages_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare u text; k text;
begin
  if new.sender_role = 'system' or new.notified_at is not null then return null; end if;
  select value into u from app_state where key = 'notify_url';      -- filled in by the app's chat check
  select value into k from app_state where key = 'notify_secret';
  if coalesce(u, '') = '' or coalesce(k, '') = '' then return null; end if;
  begin
    perform net.http_post(url := u, body := jsonb_build_object('id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-key', k), timeout_milliseconds := 8000);
  exception when others then null;                           -- never block a message; the 10-minute check sends it instead
  end;
  return null;
end $$;
drop trigger if exists chat_messages_notify on chat_messages;
create trigger chat_messages_notify after insert on chat_messages for each row execute function chat_messages_notify();

-- ── 2. Changes made outside the app are logged by the database itself ──────
-- The app's server sends a private key with every request it makes for a signed-in person (lib/supabase.ts).
-- A change to bookings, trainers, pay, reports and so on that arrives with someone's login but WITHOUT that key
-- was made from a browser console or a script, bypassing the app: it goes in the activity log as a problem,
-- and the log viewers are emailed within 10 minutes. Nothing is blocked; it's recorded.
insert into app_state (key, value) values ('db_write_key', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create or replace function via_app() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare k text; h text;
begin
  select value into k from app_state where key = 'db_write_key';
  if k is null then return null; end if;                     -- not set up: don't log anything
  begin h := current_setting('request.headers', true)::json ->> 'x-dogwise-key'; exception when others then h := null; end;
  return h is not null and h = k;
end $$;
revoke all on function via_app() from public, anon, authenticated;

create or replace function audit_direct_write() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); o jsonb; n jsonb; diff text; rid text; who text; r text;
begin
  if uid is null then return null; end if;                   -- the server's own service key: trusted
  if pg_trigger_depth() > 1 then return null; end if;        -- made by another trigger (e.g. a new chat message updating its chat), not by a person
  if via_app() is not false then return null; end if;        -- came through the app (or logging isn't set up)
  o := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  -- Normal things the app itself does from the browser: marking a chat or a message as seen
  if tg_table_name = 'chats' and tg_op = 'UPDATE' and (o - 'admin_seen_at') = (n - 'admin_seen_at') then return null; end if;
  if tg_table_name = 'messages' and tg_op = 'UPDATE' and (o - 'read_at') = (n - 'read_at') then return null; end if;
  rid := coalesce(n ->> 'id', o ->> 'id', '');
  if tg_op = 'UPDATE' then
    select string_agg(format('%s: %s → %s', k, coalesce(left(o ->> k, 80), '∅'), coalesce(left(n ->> k, 80), '∅')), '; ' order by k) into diff
      from jsonb_object_keys(n) as k where (o -> k) is distinct from (n -> k) and k not in ('updated_at', 'hubspot_synced_at');
    if diff is null then return null; end if;
  elsif tg_op = 'INSERT' then
    select string_agg(format('%s: %s', k, left(n ->> k, 60)), '; ' order by k) into diff
      from jsonb_object_keys(n) as k where n ->> k is not null and k not in ('id', 'created_at', 'updated_at');
  else
    select string_agg(format('%s: %s', k, left(o ->> k, 60)), '; ' order by k) into diff
      from jsonb_object_keys(o) as k where o ->> k is not null and k not in ('id', 'created_at', 'updated_at');
  end if;
  select coalesce(nullif(p.display_name, ''), 'Someone') || ' (' || coalesce(u.email::text, uid::text) || ')', p.role into who, r
    from auth.users u left join profiles p on p.id = u.id where u.id = uid;
  insert into audit_log (user_id, who, role, action, detail, ok, error)
  values (uid, coalesce(who, uid::text), r, 'Changed data directly, not through the app',
    left(format('%s %s %s: %s', case tg_op when 'INSERT' then 'Added to' when 'UPDATE' then 'Changed' else 'Deleted from' end, tg_table_name, rid, coalesce(diff, '')), 1000),
    false, 'Made straight to the database with this login (browser console or a script), bypassing the app and its checks');
  return null;
exception when others then return null;                      -- logging must never block a change
end $$;

do $$ declare t text; begin
  foreach t in array array['bookings', 'trainers', 'time_off', 'profiles', 'payslips', 'payslip_lines', 'pay_runs', 'trainer_rates',
                           'chats', 'chat_incidents', 'reports', 'report_reminders', 'messages', 'chat_messages'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on %I', t || '_direct_write_log', t);
      execute format('create trigger %I after %s on %I for each row execute function audit_direct_write()',
        t || '_direct_write_log', case when t = 'chat_messages' then 'update or delete' else 'insert or update or delete' end, t);
    end if;
  end loop;
end $$;
