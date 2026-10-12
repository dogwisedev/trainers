-- Chat incidents (alerts for admins), closing/archiving chats, and client email controls.
-- Run once in Supabase → SQL editor (after 007).

alter table chats add column if not exists client_emails boolean not null default true;   -- admins (or the client, via the email link) can switch off notification emails
alter table chats add column if not exists archived_at timestamptz;                       -- messages were saved to Drive and removed from the app
alter table chats add column if not exists transcript_url text;                           -- the saved transcript in Drive

create table if not exists chat_incidents (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats on delete cascade,
  kind text not null check (kind in ('trainer_silent', 'client_waiting', 'client_pileup', 'ready_to_close', 'reopened')),
  status text not null default 'open' check (status in ('open', 'taken', 'resolved')),
  detail text,
  opened_at timestamptz not null default now(),
  last_alert_at timestamptz,
  taken_by text, taken_at timestamptz,
  resolved_at timestamptz, resolved_by text, resolved_note text, auto_resolved boolean not null default false
);
-- one live incident of each kind per chat
create unique index if not exists chat_incidents_one_live on chat_incidents (chat_id, kind) where status <> 'resolved';
create index if not exists chat_incidents_status on chat_incidents (status, opened_at);

alter table chat_incidents enable row level security;
drop policy if exists chat_incidents_admin on chat_incidents;
create policy chat_incidents_admin on chat_incidents for all using (is_admin()) with check (is_admin());
 
