-- 065: "Follow-up only" bookings: a dog whose program finished before the app (or was never booked in it), added so its
-- trainer can book, log and be paid for follow-up sessions (and the client can have a chat). No program pay, forms,
-- training videos, reminders, ratings, HubSpot syncs or "New booking" email. To do gets a new kind: a trainer asking for
-- such a dog to be added. Run once (after 064).
alter table bookings add column if not exists followup_only boolean not null default false;

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
  'client_office', 'client_urgent',
  'followup_setup'
));
notify pgrst, 'reload schema';
