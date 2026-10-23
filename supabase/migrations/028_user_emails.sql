-- Activity log: show each person's email next to their name. Run once in Supabase → SQL editor (after 027). Server only.
create or replace function public.user_emails(p_ids uuid[]) returns table (id uuid, email text)
language sql security definer set search_path = public, auth stable as $$
  select u.id, u.email::text from auth.users u where u.id = any(p_ids)
$$;
revoke all on function public.user_emails(uuid[]) from public, anon, authenticated;
grant execute on function public.user_emails(uuid[]) to service_role;
