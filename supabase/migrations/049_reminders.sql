-- 049: The app reminds trainers itself (lib/nudges.ts), and hands a thing to the office only after 2 ignored reminders.
--  nudges         every reminder or check-in sent to a trainer: by the app (step 1, 2), handed to the office (step 3),
--                 or sent by a person from To do (step null). done_at = when the thing itself happened.
--  last_reply_at  the latest message in a chat from the trainer or a PERSON in the office. The app's automatic posts
--                 (training videos) no longer count as answering a waiting client.
--  form_chase     a new To do kind: a form still late after 2 reminders.
-- No foreign keys. Run once in Supabase → SQL editor (after 048).

create table if not exists nudges (
  id uuid primary key default gen_random_uuid(),
  ref text not null,                    -- the one thing: update:<chat>:<last post day>, waiting:<chat>:<first unanswered>, form:<booking>:<kind>:<week>
  kind text not null check (kind in ('update_due', 'client_waiting', 'form_late')),
  step int check (step in (1, 2, 3)),   -- 1, 2: reminders from the app · 3: handed to the office · null: a person sent it
  by text not null default 'app',       -- 'app', or the person who sent a check-in
  trainer_id uuid, chat_id uuid, booking_id uuid,
  channels text[] not null default '{}',-- push, text, email, app (team thread), call, office
  body text,                            -- what was sent
  suggested text,                       -- what the app suggested (a person's check-in), to see how often it's used as it is
  edited boolean,
  error text,
  sent_at timestamptz not null default now(),
  done_at timestamptz,                  -- when the post, reply or form came in
  outcome text check (outcome in ('done', 'gone'))  -- gone: no longer needed (chat quiet or closed, dog went home)
);
create unique index if not exists nudges_ref_step on nudges (ref, step) where step is not null;  -- each step goes once
create index if not exists nudges_open on nudges (ref) where done_at is null;
create index if not exists nudges_trainer on nudges (trainer_id, sent_at);
alter table nudges enable row level security;  -- server only

-- Person replies only (trainer, or an admin who is signed in; automatic posts have no sender)
alter table chats add column if not exists last_reply_at timestamptz;
update chats c set last_reply_at = x.at from (
  select chat_id, max(created_at) as at from chat_messages
  where sender_role = 'trainer' or (sender_role = 'admin' and sender_id is not null)
  group by chat_id
) x where x.chat_id = c.id and c.last_reply_at is null;

-- Same as 032, plus last_reply_at
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
    last_admin_at = case when new.sender_role = 'admin' then new.created_at else last_admin_at end,
    last_reply_at = case when new.sender_role = 'trainer' or (new.sender_role = 'admin' and new.sender_id is not null) then new.created_at else last_reply_at end
  where id = new.chat_id;
  return new;
end $$;

do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'chat_incidents'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table chat_incidents drop constraint %I', c);
  end loop;
end $$;
alter table chat_incidents add constraint chat_incidents_kind_check check (kind in (
  'trainer_silent', 'client_waiting', 'client_pileup', 'ready_to_close', 'reopened',
  'intake_media_missing', 'handover_photo_missing',
  'overbooked', 'length_changed', 'booking_cancelled', 'hubspot_problem',
  'not_ready', 'check_vaccines', 'trainer_report', 'deal_not_booked',
  'standby_reminder', 'followup_request', 'followup_report',
  'pickup_unconfirmed', 'dropoff_unconfirmed',
  'trainer_offer', 'ask_pedro',
  'form_chase'
));
notify pgrst, 'reload schema';
