-- 059: Where the work goes. For learning how the app is used and why, so the next month's automation picks itself:
--  work_reasons     the one-tap "why" when a person overrides the app (a form marked not needed, a To do item closed by
--                   hand, a booking forced, a client item closed): action, what it was about, who, the reason
--  hubspot_changes  deal properties changed by a person in HubSpot itself (not by the app or a workflow), pulled daily
--                   from HubSpot's own history: the work that still happens outside the app
-- Read on Pulse → Where the work goes. Server only. Run once (after 058).
create table if not exists work_reasons (
  id uuid primary key default gen_random_uuid(),
  action text not null, item text, label text, who text, reason text not null,
  at timestamptz not null default now()
);
create index if not exists work_reasons_at on work_reasons (at desc);
alter table work_reasons enable row level security;

create table if not exists hubspot_changes (
  deal_id text not null, property text not null, at timestamptz not null,
  value text, by_user text, source text,
  dog text, client text,
  seen_at timestamptz not null default now(),
  primary key (deal_id, property, at)
);
create index if not exists hubspot_changes_at on hubspot_changes (at desc);
alter table hubspot_changes enable row level security;
notify pgrst, 'reload schema';
