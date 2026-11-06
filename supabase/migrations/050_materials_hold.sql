-- 050: Training materials pause when HubSpot says the program is off while the booking is still live in the app:
-- Client Status Cancelled, Refunded or Standby, or the deal is no longer Closed Won. The HubSpot sync (lib/hubspotSync.ts,
-- every 30 minutes) sets hs_hold to the reason and clears it when HubSpot is back to normal; nothing is posted while it's
-- set. (Cancel and Postpone in the app already stop them: a cancelled booking gets no materials.) Run once (after 049).
alter table bookings add column if not exists hs_hold text;
notify pgrst, 'reload schema';
