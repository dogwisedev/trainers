-- 056: "Speak" in chats and forms: speech to text, then tidied by AI into a message or into the form's answers. Never an
-- audio message: the recording is turned into text and thrown away. This table only counts uses, for Pulse → Office.
-- Server only. Run once (after 055).
create table if not exists ai_voice (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, role text, mode text not null check (mode in ('chat', 'form')),
  chat_id uuid, report_id uuid,
  seconds int, heard_chars int, fields_set int, questions int,
  created_at timestamptz not null default now()
);
alter table ai_voice enable row level security;
notify pgrst, 'reload schema';
