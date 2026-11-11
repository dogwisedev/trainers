-- 058: AI trust. Every time a person decides on something the AI did (a vaccine check, a form check, a client message's
-- label, an AI-written message), it's logged here, so Pulse → Office → AI help can show each feature's approval rate and
-- flag patterns worth a look (changing a decision back, many approvals seconds apart, one person disagreeing far more than
-- the rest). Small edits (a typo, a word) count as agreeing. Also: how much was changed on a form check, and what was
-- finally sent after Speak tidied a message. Server only. Run once (after 057).
create table if not exists ai_decisions (
  id uuid primary key default gen_random_uuid(),
  feature text not null,                 -- vaccines, forms, messages, captions, speak, handover
  item_id text not null,                 -- the dog, the form, the message…
  item_label text,                       -- "Lexi's vaccines", "Bear: weekly check (week 2)"
  ai text,                               -- what the AI said: ok / missing / check / reply / office…
  decision text not null,                -- what the person did: ok / missing / approved / sent_back / corrected / kept…
  agreed boolean,                        -- null: the AI left it to a person
  change text check (change in ('none', 'minor', 'major')),
  by text, at timestamptz not null default now(),
  spot boolean not null default false,   -- a spot check while the feature runs on its own
  auto boolean not null default false    -- decided by the app on its own (not a person)
);
create index if not exists ai_decisions_feature_at on ai_decisions (feature, at desc);
create index if not exists ai_decisions_item on ai_decisions (feature, item_id, at);
alter table ai_decisions enable row level security;

alter table ai_form_checks add column if not exists change text;
alter table ai_voice add column if not exists tidied text;
alter table ai_voice add column if not exists final text;
alter table ai_voice add column if not exists sent_at timestamptz;
notify pgrst, 'reload schema';
