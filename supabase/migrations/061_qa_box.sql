-- 061: The QA box, natively. Flagging a client in the app ticks "Flagged in QA or channels" (qa_flagged) and mailer_hold on
-- all their HubSpot contacts (duplicates by email or phone too), and moves their live Follow Up deal to Manual Only, so no
-- automation emails them (Sean's rule, 23 Oct, 7 and 9 Nov 2026). Checked again 20 minutes and a day later. Never unticks.
-- Server only. Run once (after 060).
create table if not exists qa_flags (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null, booking_id uuid, client text, dog text, reason text, by text,
  status text not null default 'ticked' check (status in ('ticked', 'already', 'hand', 'error')),
  contacts text[] not null default '{}', moved text[] not null default '{}', found text, error text,
  at timestamptz not null default now(), checked_at timestamptz, checks int not null default 0
);
create index if not exists qa_flags_deal on qa_flags (deal_id, at desc);
alter table qa_flags enable row level security;
notify pgrst, 'reload schema';
