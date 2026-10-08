-- Run once in Supabase SQL editor (already included in schema.sql for new installs).
alter table bookings add column if not exists source text;
create index if not exists bookings_hubspot_deal on bookings (hubspot_deal_id);
