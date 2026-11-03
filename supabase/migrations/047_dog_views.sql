-- 047: Saved views on Dogs (a name + the tab and filters), shared by everyone in the office. Starts with the office's
-- HubSpot reports; anyone can save more or remove one. Dates are kept relative ("this weekend"), so views stay right.
-- Run once in Supabase → SQL editor (after 046).
create table if not exists dog_views (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  query text not null,               -- e.g. f=upcoming&sw=weekend&vac=missing
  sort int not null default 100,
  created_by text,
  created_at timestamptz not null default now()
);
alter table dog_views enable row level security;  -- server only
insert into dog_views (name, query, sort, created_by)
select * from (values
  ('Starting this weekend', 'f=upcoming&sw=weekend', 1, 'Dogwise'),
  ('Vaccines missing · this weekend', 'f=upcoming&sw=weekend&vac=missing', 2, 'Dogwise'),
  ('Forms missing · this weekend', 'f=upcoming&sw=weekend&forms=missing', 3, 'Dogwise'),
  ('Balance due · this weekend', 'f=upcoming&sw=weekend&bal=owed', 4, 'Dogwise'),
  ('Handover this weekend', 'f=now&ew=weekend', 5, 'Dogwise'),
  ('Completing next week', 'f=now&ew=nextweek', 6, 'Dogwise'),
  ('Money outstanding', 'f=now&bal=owed', 7, 'Dogwise'),
  ('Finished, no follow-up booked', 'f=finished&fu=none', 8, 'Dogwise')
) v(name, query, sort, created_by)
where not exists (select 1 from dog_views);
notify pgrst, 'reload schema';
