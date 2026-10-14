# DogwiseTrainers

Kennel calendar and trainer hub for Dogwise Academy. Phone-first, installable to the home screen.

- **Trainers** sign in and see only their own calendar: dogs with them, what's coming, free kennels per week. They block time off (whole calendar or some kennels), edit their contact and vet details, and message the Dogwise team.
- **Admins** see every trainer: the week-by-week kennel map, profiles with all the sheet details, bookings, time off, messages, and can add, deactivate and invite trainers.
- **Source of truth**: replaces the Trainer Availability grid. `/api/availability` feeds Bark Buster and the sales assistant.

## Try it now (demo mode)
With no Supabase keys the app runs on today's import of the Bookings + Availability sheet (42 trainers, 173 bookings, 42 time-off blocks). On the sign-in page pick "Admin" or any trainer. Nothing saves in demo mode.

```
npm install
npm run dev     # http://localhost:3000
```

## Go live (about 20 minutes)
1. **Supabase**: create a project at supabase.com. In SQL editor run `supabase/schema.sql`, then `supabase/seed.sql`.
2. **Auth settings** (Authentication → URL configuration): Site URL = your Vercel URL; add `https://<your-url>/auth/callback` to redirect URLs. For real emails, add SMTP (Resend works) under Authentication → SMTP; Supabase's built-in email is rate-limited.
3. **Your admin login**: Authentication → Users → Add user (your email + password). Then in SQL editor:
   ```sql
   insert into profiles (id, role, display_name)
   select id, 'admin', 'Dogwise team' from auth.users where email = 'you@dogwiseacademy.com';
   ```
4. **Vercel**: import the repo, set the variables from `.env.example`, deploy.
5. **Invite trainers**: open a trainer → "Send login". They get an email, land on their profile and set a password. Do this after you've checked their profile.

## Rules the database enforces (row level security)
- A trainer can only read their own profile, bookings, time off and messages.
- Trainers can edit their contact, vet and bio fields. Capacity, range, programs, status and admin notes are locked to admins. If a trainer changes their address, a "check ZIP" flag appears for admins.
- Only admins create or cancel bookings. Trainers can't post messages as admin.
These were tested against Postgres with the seed data.

## Data notes from the import
- Active = the 42 trainers you confirmed. Capacity = "# of Dogs" from Detailed Trainer Information.
- Bookings = "Client/Dog" cells from Aug 2026 onward, with their merged week spans. The sheet colours are kept in `sheet_color` until we know what each means.
- Time off = red/unavailable cells, merged into ranges. Where only some slot rows were red, it's stored as "some kennels blocked".
- Flags to check: Tressie (SC vs NY), Tracie (33315 vs 33021), Joseph Serrano (93635 vs 93265).
- Re-generate `seed.sql` after editing `lib/demo-seed.json`: `npm run seed:sql`.

## HubSpot dates (source of truth)
Booking dates follow the HubSpot deal (`/api/hubspot/sync`, every 30 minutes, and right after a booking is made).
- Vercel variables: `HUBSPOT_TOKEN` (deals read), `HUBSPOT_SYNC` = `dry` (default, writes nothing) → `quiet` (writes, no emails) → `live`.
  Optional: `HUBSPOT_START_PROP`, `HUBSPOT_END_PROP` (found automatically as Program Start Date / Training End Date), `OFFICE_EMAIL` (default info@dogwiseacademy.com).
- Preview: signed in as an admin, open `/api/hubspot/sync` in the browser (always a dry run from there).
- Several dogs on one deal: HubSpot's start is the first dog's pickup and every dog moves by the same days; HubSpot's end goes to the dog(s) that end last.
- Only bookings that ended in the last 14 days or later are moved. Approved payslips are never touched.
- Incidents: overbooked, program length changed, deal no longer Closed Won (these two also email info@), deal missing / no start date.

## Before training (Dog profile)
The client's answers to the two HubSpot forms, per dog, plus the checklist: forms, vaccines, food, medication, balance.
- Chats have a **Dog profile** button (admin, trainer, client). Admin and client can edit; trainers read only. Clients also get a "Before training" card on their chat.
- Admin list: `/a/ready`. A "Not ready" incident opens 7 days before a dog starts if anything is missing, and clears itself.
- Answers are HubSpot **contact** properties (dog 1 = `k9___dog_name`). Dogs 2 to 4 (`dog_2_name`…) are kept in the app, so they never overwrite dog 1.
- Vaccines: admin checks the records, which writes `vaccines_in_order_` and `missing_vaccines` on the deal. Clients upload records to the chat's Drive folder.
- The app ticks `forms` on the deal once every answer is in, and fills `pre_training_missing` if you create that deal property (single-line text).
- HubSpot token scopes: `crm.objects.deals.read/write`, `crm.objects.contacts.read/write`, `crm.schemas.deals.read`, `crm.schemas.contacts.read`.
