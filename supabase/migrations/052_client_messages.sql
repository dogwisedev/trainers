-- 052: Reading what clients write, so only real questions chase the trainer.
--  message_needs   one row per client message: who has to act on it. reply = the trainer (a question about the dog,
--                  pickup, training); office = the office (payment, dates, refunds, or written to someone else);
--                  none = nothing to answer ("Yes, that's perfect", thanks, an emoji); urgent = now (a bite, an injury,
--                  illness, an escape, an upset client). Set by the 10-minute chat check: Claude when ANTHROPIC_API_KEY
--                  is set, simple rules otherwise. first = its first answer, so people's corrections show how well it
--                  does. handled_*: an office or urgent message dealt with outside the chat (a call, an email).
--                  Server only (no policies): clients and trainers never see it.
--  chats.reply_waived_*  "No reply needed" from To do: counts as an answer to everything the client had sent up to then.
--  New To do kinds: client_office (a client asked the office), client_urgent (a client message that needs attention now).
-- Run once (after 051).
create table if not exists message_needs (
  message_id uuid primary key,
  chat_id uuid not null,
  sent_at timestamptz not null,                        -- the message's own time
  needs text not null check (needs in ('reply', 'office', 'none', 'urgent')),
  why text,                                            -- a few words: "Payment question for the office"
  by text not null default 'ai',                       -- ai, rules, or the person who corrected it
  first text check (first in ('reply', 'office', 'none', 'urgent')),
  at timestamptz not null default now(),
  handled_at timestamptz, handled_by text
);
create index if not exists message_needs_chat on message_needs (chat_id, sent_at);
alter table message_needs enable row level security;

alter table chats add column if not exists reply_waived_at timestamptz;
alter table chats add column if not exists reply_waived_by text;

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
  'form_chase',
  'client_office', 'client_urgent'
));
notify pgrst, 'reload schema';
