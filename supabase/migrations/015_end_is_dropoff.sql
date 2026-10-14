-- A booking's end date is now the DROP-OFF day: the same weekday as pickup, X weeks later (Sunday to Sunday),
-- exactly like HubSpot's Training End Date. The drop-off day doesn't take a kennel and isn't paid.
-- Old bookings stored the last night in care instead (Sunday to Saturday): they move one day, so nothing changes
-- on the calendar or in pay. Bookings already holding HubSpot's dates are left as they are.
-- Run once in Supabase → SQL editor, RIGHT BEFORE pushing the code (after 014). Safe to run twice: it only moves each booking once.

alter table bookings add column if not exists end_is_dropoff boolean not null default false;  -- existing rows: not converted yet
alter table bookings alter column end_is_dropoff set default true;                             -- new rows come in the new way

with moved as (
  update bookings set end_date = end_date + 1
  where not end_is_dropoff and not (hubspot_deal_id is not null and hubspot_synced_at is not null)
  returning id
)
-- Handover forms not yet submitted are due from the drop-off day
update reports set due_by = due_by + interval '1 day'
where kind = 'handover' and status in ('draft', 'changes_requested') and due_by is not null and booking_id in (select id from moved);

-- Extra days = days in care beyond the program's full weeks. HubSpot bookings lose the "+1 day" the drop-off day used to add.
update bookings set extra_days = greatest(0, least(13, (end_date - start_date) - coalesce(weeks, 1) * 7)) where not end_is_dropoff;
update bookings set end_is_dropoff = true where not end_is_dropoff;
