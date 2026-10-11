-- Remembers who has chosen a password, so the app can remind people who signed in with an email link.
alter table profiles add column if not exists password_set boolean not null default false;
-- Admins created with a password (create-admins.sql) already have one
update profiles p set password_set = true
from auth.users u where u.id = p.id and p.role = 'admin' and coalesce(u.encrypted_password, '') <> '';
