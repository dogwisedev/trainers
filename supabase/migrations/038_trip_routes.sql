-- 038: Mileage check. The driving distance from the trainer to the client, one row per booking and trainer, worked out with
-- FreeRoute (or estimated from ZIPs when it can't answer). Shown next to the miles trainers declare, on the payslip, with a
-- Google Maps link to check it. Worked out again only when an address changes (input_key). See lib/tripRoutes.ts.
-- Run once in Supabase → SQL editor (after 037).

create table if not exists trip_routes (
  booking_id uuid not null references bookings on delete cascade,
  trainer_id uuid not null references trainers on delete cascade,
  input_key text not null,                                          -- the addresses it was worked out from
  one_way_miles numeric(7,1),                                       -- null = couldn't be worked out (see note)
  method text check (method in ('route', 'estimate')),              -- route = FreeRoute; estimate = straight line + 25%
  from_label text, to_label text,                                   -- what was used, in words
  from_source text, to_source text,                                 -- 'address' | 'profile' | 'zip'
  google_url text,                                                  -- the same trip in Google Maps, to check by hand
  note text,
  checked_at timestamptz not null default now(),
  primary key (booking_id, trainer_id)
);
alter table trip_routes enable row level security;                  -- server only
