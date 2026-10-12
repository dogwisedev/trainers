-- Booking chats: one per booking (per HubSpot deal), shared by the client, the trainer and ALL admins.
-- Text lives here; photos and videos live in Google Drive (the chat just links to them).
-- Run once in Supabase → SQL editor (after 006).

-- Clients are people too: they sign in with an emailed link and see only their own chat.
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%' loop
    execute format('alter table profiles drop constraint %I', c);
  end loop;
end $$;
alter table profiles add constraint profiles_role_check check (role in ('admin', 'trainer', 'client'));

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  deal_key text not null,                                   -- HubSpot deal id, or the booking id when there is no deal
  trainer_id uuid references trainers on delete set null,
  trainer_name text,
  client_user_id uuid references auth.users on delete set null,
  client_name text, client_email text,
  title text,                                               -- e.g. "Kya & Milo"
  status text not null default 'open' check (status in ('open', 'closed')),
  drive_folder_id text, drive_folder_url text,              -- "Look at media"
  previous_chat_id uuid references chats on delete set null,
  last_message_at timestamptz, last_preview text, last_sender text,   -- for the chat lists
  last_trainer_at timestamptz, last_client_at timestamptz, last_admin_at timestamptz,
  admin_seen_at timestamptz,                                -- admins share one "seen" mark: any admin opening it clears it for all
  invited_at timestamptz,                                   -- when the client was emailed their link
  notified_client_at timestamptz, notified_trainer_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists chats_one_open_per_deal on chats (deal_key) where status = 'open';
create index if not exists chats_trainer on chats (trainer_id, status);
create index if not exists chats_client on chats (client_user_id, status);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats on delete cascade,
  sender_id uuid references auth.users on delete set null,
  sender_role text not null check (sender_role in ('admin', 'trainer', 'client', 'system')),
  sender_name text,
  kind text not null default 'text' check (kind in ('text', 'media', 'report', 'system')),
  body text,
  media jsonb not null default '[]',                        -- [{ id, name, kind: video|photo, size }] files in Drive
  report_id uuid references reports on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_chat on chat_messages (chat_id, created_at);

-- Trainers and clients each have their own "read up to" mark
create table if not exists chat_reads (
  chat_id uuid not null references chats on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

-- Who is this person in this chat? (admin sees everything; the trainer and client only their own)
create or replace function chat_access(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when is_admin() then 'admin'
    when exists (select 1 from chats c where c.id = cid and c.trainer_id is not null and c.trainer_id = my_trainer_id()) then 'trainer'
    when exists (select 1 from chats c where c.id = cid and c.client_user_id = auth.uid()) then 'client'
  end
$$;

-- The database stamps who sent a message, so nobody can pose as someone else.
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
  new.kind := case when new.kind in ('text', 'media') then new.kind else 'text' end;
  new.body := left(new.body, 4000);
  new.report_id := null;
  new.sender_name := case who
    when 'admin' then 'Dogwise team'
    when 'trainer' then (select name from trainers where id = my_trainer_id())
    else (select client_name from chats where id = new.chat_id) end;
  return new;
end $$;
drop trigger if exists chat_messages_bi on chat_messages;
create trigger chat_messages_bi before insert on chat_messages for each row execute function chat_messages_before_insert();

create or replace function chat_messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update chats set
    last_message_at = new.created_at,
    last_preview = left(coalesce(nullif(new.body, ''), case when new.kind = 'media' then 'Sent a photo or video' when new.kind = 'report' then 'Report' else '' end), 90),
    last_sender = new.sender_role,
    last_trainer_at = case when new.sender_role = 'trainer' then new.created_at else last_trainer_at end,
    last_client_at = case when new.sender_role = 'client' then new.created_at else last_client_at end,
    last_admin_at = case when new.sender_role = 'admin' then new.created_at else last_admin_at end
  where id = new.chat_id;
  return new;
end $$;
drop trigger if exists chat_messages_ai on chat_messages;
create trigger chat_messages_ai after insert on chat_messages for each row execute function chat_messages_after_insert();

alter table chats enable row level security;
alter table chat_messages enable row level security;
alter table chat_reads enable row level security;

drop policy if exists chats_read on chats;
create policy chats_read on chats for select using (chat_access(id) is not null);
drop policy if exists chats_admin on chats;
create policy chats_admin on chats for all using (is_admin()) with check (is_admin());

drop policy if exists chat_messages_read on chat_messages;
create policy chat_messages_read on chat_messages for select using (chat_access(chat_id) is not null);
drop policy if exists chat_messages_write on chat_messages;
create policy chat_messages_write on chat_messages for insert with check (chat_access(chat_id) is not null and kind in ('text', 'media'));
drop policy if exists chat_messages_admin_delete on chat_messages;
create policy chat_messages_admin_delete on chat_messages for delete using (is_admin());

drop policy if exists chat_reads_own on chat_reads;
create policy chat_reads_own on chat_reads for all using (user_id = auth.uid() and chat_access(chat_id) is not null) with check (user_id = auth.uid() and chat_access(chat_id) is not null);

do $$ begin
  alter publication supabase_realtime add table chat_messages;
exception when others then null; end $$;
