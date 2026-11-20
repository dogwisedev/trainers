-- 063: A record of every client agreeing to the Terms & Conditions (typing their name in the before-training form, in the
-- app or on the HubSpot form): who, when, from where, and which version, so "I never signed" can be answered. The client is
-- emailed a warm welcome with a copy attached (lib/terms.ts). The terms' text is kept in app_settings (terms.text,
-- terms.data, terms.version), edited on /a/terms. Server only. Run once (after 062).
create table if not exists terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null, contact_email text, name text not null,
  source text not null check (source in ('app', 'hubspot', 'admin')),
  ip text, user_agent text, terms_url text, terms_version text,
  at timestamptz not null default now(), emailed_at timestamptz, email_error text
);
create index if not exists terms_acceptances_deal on terms_acceptances (deal_id, at desc);
alter table terms_acceptances enable row level security;
notify pgrst, 'reload schema';
