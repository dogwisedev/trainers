-- Remaining-balance links: remember which Stripe link the app made and for how much,
-- so an extension (the deal's amount going up) gets a fresh link for the new balance.
-- Run once in Supabase → SQL editor (after 024).
alter table deal_money add column if not exists link_amount numeric(10,2);
alter table deal_money add column if not exists link_id text;
