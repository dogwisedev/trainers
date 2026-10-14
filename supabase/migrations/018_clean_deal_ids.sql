-- Bookings (and their chats) where the whole HubSpot link was pasted as the deal ID: keep just the deal number.
-- The app now does this itself on the way in. Run once in Supabase → SQL editor (after 017). Safe to run again.
update bookings set hubspot_deal_id = substring(hubspot_deal_id from 'record/0-3/([0-9]+)')
where hubspot_deal_id ~ 'record/0-3/[0-9]+';

-- The chat's key is the deal ID too (skipped if the deal already has another open chat: fix that one by hand)
update chats c set deal_key = substring(c.deal_key from 'record/0-3/([0-9]+)')
where c.deal_key ~ 'record/0-3/[0-9]+'
  and not exists (select 1 from chats o where c.status = 'open' and o.status = 'open' and o.deal_key = substring(c.deal_key from 'record/0-3/([0-9]+)'));

-- Close the "Check HubSpot" incidents raised for those links
update chat_incidents set status = 'resolved', resolved_at = now(), resolved_by = 'automatic', resolved_note = 'Deal ID fixed', auto_resolved = true
where ref like 'deal:http%' and status <> 'resolved';

-- Anything left that still isn't a plain number (shows here so you can fix it by hand)
select id, dog_name, client_name, hubspot_deal_id from bookings where hubspot_deal_id is not null and hubspot_deal_id !~ '^[0-9]+$';
