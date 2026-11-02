-- 041: Scheduled messages. A trainer or admin writes a message (text, photos, videos) and picks a date and time; the
-- 10-minute chat job posts it into the chat at that time, as them. Until then the client has nothing: no message, no
-- preview, no notification. The trainer and the office see it under "Scheduled" with Cancel. No foreign keys beyond the chat.
-- Run once in Supabase → SQL editor (after 040).
create table if not exists scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats on delete cascade,
  created_by uuid not null,                       -- auth user who scheduled it (it's posted as them)
  sender_role text not null check (sender_role in ('admin', 'trainer')),
  sender_name text,
  body text,
  media jsonb not null default '[]',
  send_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_message_id uuid,                           -- set once posted
  cancelled_at timestamptz,
  note text
);
create index if not exists scheduled_messages_due on scheduled_messages (send_at) where sent_message_id is null and cancelled_at is null;
alter table scheduled_messages enable row level security;  -- server only
