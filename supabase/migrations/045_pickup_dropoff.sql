-- 045: Pickup and drop-off are confirmed events (the trainer taps Picked up / Dropped home, or the intake / handover form
-- comes in), not just dates. Dogs, HubSpot's Client Status and Pick Up / Drop Off Confirmation follow these.
-- No foreign keys. Run once in Supabase → SQL editor (after 044).
alter table bookings add column if not exists picked_up_at timestamptz;
alter table bookings add column if not exists picked_up_by text;
alter table bookings add column if not exists dropped_off_at timestamptz;
alter table bookings add column if not exists dropped_off_by text;
alter table bookings add column if not exists pickup_prompted_at timestamptz;   -- the 5 PM push, sent once
alter table bookings add column if not exists dropoff_prompted_at timestamptz;

-- The past: anything that started (or ended) before Nov 1 counts as picked up (or dropped off) on its date
update bookings set picked_up_at = (start_date + time '12:00') at time zone 'America/New_York', picked_up_by = 'Before confirmations'
  where picked_up_at is null and status <> 'cancelled' and start_date < date '2026-11-01';
update bookings set dropped_off_at = (end_date + time '12:00') at time zone 'America/New_York', dropped_off_by = 'Before confirmations'
  where dropped_off_at is null and status <> 'cancelled' and end_date < date '2026-11-01';
-- Forms already in count as confirmations
update bookings b set picked_up_at = r.submitted_at, picked_up_by = 'Intake form'
  from reports r where r.booking_id = b.id and r.kind = 'intake' and r.submitted_at is not null and b.picked_up_at is null and b.status <> 'cancelled';
update bookings b set dropped_off_at = r.submitted_at, dropped_off_by = 'Handover report'
  from reports r where r.booking_id = b.id and r.kind = 'handover' and r.submitted_at is not null and b.dropped_off_at is null and b.status <> 'cancelled';

-- To do: a pickup or drop-off nobody confirmed by the next morning
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
  'pickup_unconfirmed', 'dropoff_unconfirmed'
));
notify pgrst, 'reload schema';
