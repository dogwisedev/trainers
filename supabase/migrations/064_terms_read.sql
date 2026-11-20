-- 064: The agreement record also keeps whether they ticked "I have read and agree to the Terms & Conditions", and a
-- fingerprint (SHA-256) of the exact terms text they agreed to, so it can be shown it hasn't changed since.
-- Run once (after 063).
alter table terms_acceptances add column if not exists read_confirmed boolean;
alter table terms_acceptances add column if not exists terms_hash text;
alter table terms_acceptances add column if not exists program text;
notify pgrst, 'reload schema';
