-- Fast user lookups: replaces asking Supabase's login service for EVERY account (slow, and it was slowing logins down).
-- Run once in Supabase → SQL editor (after 022). Only the server (service role) can call these.
create or replace function public.user_id_by_email(p_email text) returns uuid
language sql security definer set search_path = public, auth stable as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1
$$;
create or replace function public.last_sign_ins(p_ids uuid[]) returns table (id uuid, last_sign_in_at timestamptz)
language sql security definer set search_path = public, auth stable as $$
  select u.id, u.last_sign_in_at from auth.users u where u.id = any(p_ids)
$$;
revoke all on function public.user_id_by_email(text) from public, anon, authenticated;
revoke all on function public.last_sign_ins(uuid[]) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;
grant execute on function public.last_sign_ins(uuid[]) to service_role;
