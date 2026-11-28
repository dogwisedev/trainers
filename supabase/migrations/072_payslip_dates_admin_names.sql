-- 072: Run once (after 071). Safe to run again.
-- 1. Payslips: the "Submitted" date printed on a pay run's payslips can be chosen (the paid date is pay_runs.paid_date, which
--    could always be changed). submit_date itself stays as it is: it is how the app finds the run.
alter table pay_runs add column if not exists shown_submit_date date;

-- 2. Chats: a message from the office says who wrote it ("Anita, Dogwise team"), not only "Dogwise team". The first name
--    from the admin's profile; a profile with no real name ("Dogwise team", "Dogwise Admin") stays "Dogwise team".
--    The rest of this function is exactly as migration 033 left it.
create or replace function chat_messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; first text;
begin
  if auth.uid() is null then return new; end if;            -- the server (service role) writes system messages itself
  who := chat_access(new.chat_id);
  if who is null then raise exception 'not allowed to write in this chat'; end if;
  if not exists (select 1 from chats where id = new.chat_id and status = 'open') then raise exception 'this chat is closed'; end if;
  new.sender_id := auth.uid();
  new.sender_role := who;
  new.created_at := now();
  new.notified_at := null;
  new.kind := case when new.kind in ('text', 'media') then new.kind else 'text' end;
  new.body := left(new.body, 4000);
  new.report_id := null;
  if who = 'admin' then
    select nullif(split_part(btrim(coalesce(display_name, '')), ' ', 1), '') into first from profiles where id = auth.uid();
    if first is null or lower(first) = 'dogwise' or position('@' in first) > 0 then first := null; end if;
  end if;
  new.sender_name := case who
    when 'admin' then case when first is null then 'Dogwise team' else first || ', Dogwise team' end
    when 'trainer' then (select name from trainers where id = my_trainer_id())
    else (select client_name from chats where id = new.chat_id) end;
  return new;
end $$;
notify pgrst, 'reload schema';
