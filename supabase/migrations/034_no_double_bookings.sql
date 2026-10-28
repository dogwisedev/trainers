-- 034: A dog can't have two live bookings on the same HubSpot deal for overlapping dates (two kennels, double pay).
-- Checked by the database, so it holds whichever way a booking is made or linked (app, extension, SQL editor).
-- A trainer change mid-training is fine: the two halves don't overlap (one ends the day the other starts).
-- Run once in Supabase → SQL editor (after 033). Bookings that are already doubled are left alone until fixed.

create or replace function bookings_no_double_dog() returns trigger
language plpgsql as $$
declare twin record;
begin
  if new.status = 'cancelled' or coalesce(new.hubspot_deal_id, '') = '' or coalesce(trim(new.dog_name), '') = '' then return new; end if;
  -- Updates only matter when the deal, the dog or "cancelled" changes (date moves shift every dog on a deal together)
  if tg_op = 'UPDATE' and new.hubspot_deal_id is not distinct from old.hubspot_deal_id
     and new.dog_name is not distinct from old.dog_name and old.status <> 'cancelled' then return new; end if;
  select b.dog_name, b.start_date, b.end_date into twin from bookings b
  where b.id <> new.id and b.status <> 'cancelled' and b.hubspot_deal_id = new.hubspot_deal_id
    and lower(regexp_replace(trim(b.dog_name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(new.dog_name), '\s+', ' ', 'g'))
    and b.start_date < new.end_date and new.start_date < b.end_date
  limit 1;
  if found then
    raise exception '% is already booked on this HubSpot deal (% to %). This would be a duplicate booking.', twin.dog_name, twin.start_date, twin.end_date
      using errcode = 'unique_violation';
  end if;
  return new;
end $$;

drop trigger if exists bookings_no_double_dog on bookings;
create trigger bookings_no_double_dog before insert or update of hubspot_deal_id, dog_name, status, start_date, end_date on bookings
  for each row execute function bookings_no_double_dog();
