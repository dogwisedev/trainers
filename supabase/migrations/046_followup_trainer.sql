-- 046: A different trainer for the follow-up sessions (after the program, or whenever): they join the dog's chat, see
-- the dog, book and log the follow-ups, and are paid for them. The program trainer stays on the booking (and its pay).
-- Run once in Supabase → SQL editor (after 045).
alter table bookings add column if not exists followup_trainer_id uuid;
alter table chats add column if not exists extra_trainer_ids uuid[] not null default '{}';

-- Chat access: the chat's trainer, or a trainer added to it (the follow-up trainer)
create or replace function chat_access(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when is_admin() then 'admin'
    when exists (select 1 from chats c where c.id = cid and c.trainer_id is not null and c.trainer_id = my_trainer_id()) then 'trainer'
    when exists (select 1 from chats c where c.id = cid and my_trainer_id() is not null and my_trainer_id() = any(c.extra_trainer_ids)) then 'trainer'
    when exists (select 1 from chats c where c.id = cid and c.client_user_id = auth.uid()) then 'client'
  end
$$;

-- The follow-up trainer can see the booking (their Past dogs, the follow-up pages)
drop policy if exists bookings_followup_read on bookings;
create policy bookings_followup_read on bookings for select using (followup_trainer_id is not null and followup_trainer_id = my_trainer_id());
notify pgrst, 'reload schema';
