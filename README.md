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
5. **Invite trainers**: open a trainer → "Send login". They get an email, land on their profile and set a password. Do this after you've checked their profile. In the installed app they can also sign in with "Email me a code".

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
- `lib/demo-seed.json` is made-up demo data (no real people). Never put real trainer or client details in the repo.

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

## October 2026 update (run once)
1. Supabase → SQL editor: run `supabase/migrations/032_audit_outcomes_and_integrity.sql`, then `033_server_notifications_and_direct_edit_log.sql` (in that order; don't re-run 032 after 033).
2. Vercel variables (optional, defaults shown):
   - `CHAT_AUTO_INVITE` (on). Clients get their chat link 7 days before training, or straight away if the booking is later than that. `off` stops it.
   - `UNBOOKED_FROM` = `2026-10-11`. Closed Won deals from this date with no booking show on To do.
3. Each admin: Your account → Your name, so the activity log shows who did what.

What changed:
- Sign in: "Email me a code" sends a 6-digit code, typed into the app (works in the installed iPhone app). Sign out asks first.
- Chats: messages can't double-send or get lost on weak signal (ids made on the phone, unsent messages kept and resent). PDFs allowed. Uploads use small pieces, wait for signal and resume. Photos, videos and PDFs open in the app. Failed uploads are in the activity log.
- Book a dog: the HubSpot deal is required and fills the form. Same checks as the extension (no dog booked twice, free kennel or "Book anyway").
- To do: "Closed Won, not booked" (from Oct 11) with Book now / Not a booking; a warning if a background job stops running.
- Activity log: logged after each action with whether it worked, each admin's name and email (chat messages too), System entries (HubSpot date moves, invites, archives, payroll drafts, client emails), Problems filter, error screens.
- Trainers: 4 tabs (Today, Chats, Forms, Me), ⋯ menu in each chat. Loading and error screens everywhere. One type scale, AA contrast.
- Security: chat message times stamped by the database, team messages can only be marked read, chat messages can't be deleted from a browser.
- Chat notifications are sent by the server, once per message: the database calls `/api/chat/notify` the moment a message is saved (pg_net), the sender's app asks too, and the 10-minute check sends anything both missed (logged as "Sent missed chat notifications"). The app registers its own address on its first chat check after deploying; nothing to set by hand.
- Changes made outside the app: any change to bookings, trainers, time off, profiles, pay, reports, chats or incidents made with someone's login but not through the app (browser console, scripts) is logged by the database as "Changed data directly, not through the app", with who and what changed, and emailed to `LOG_VIEWERS` (alma@) within 10 minutes. Nothing is blocked.

## The app's own address (app.dogwiseacademy.com)
1. Vercel → project → Settings → Domains: add `app.dogwiseacademy.com`, then add the DNS record Vercel shows at your DNS host.
2. Vercel → Environment Variables (Production): `NEXT_PUBLIC_SITE_URL` = `https://app.dogwiseacademy.com`, `APP_HOST` = `app.dogwiseacademy.com`. Redeploy.
3. Supabase → Authentication → URL Configuration: Site URL `https://app.dogwiseacademy.com`, and add `https://app.dogwiseacademy.com/**` to Redirect URLs (keep the vercel.app ones).
Page visits to the vercel.app address then move to the new one. `/api` keeps working on both, so Stripe, the HubSpot extension, crons and the availability feed need no change.
Everyone signs in once more on the new address (password or "Email me a code") and re-adds the app to their home screen; turning notifications on there stops them on the old install.

## Quiet chats close by themselves
After 53 days with no messages from anyone (and no dog in care now or coming up), a notice goes in the chat: "This chat will close on <date> unless someone writes here." Seven days later, if still quiet, the chat closes: the transcript is saved to Drive and emailed to the client, as when an admin closes it. Each step is in the activity log. Anyone writing in the chat restarts the clock. `CHAT_AUTO_CLOSE=off` in Vercel goes back to closing by hand ("Ready to close" on To do).

## Claude connector
The app is a custom connector in Claude (Organization settings > Connectors > Add > Custom > Web), so anyone in the Dogwise Claude org who turns it on can ask Claude about bookings, chats and forms.
- Address: `https://<app address>/api/mcp`. In the connector's settings choose "No sign-in" and add the request header `Authorization` with the value `Bearer <CLAUDE_MCP_KEY>`. (Request headers are still a beta in Claude: if the dialog has no "Request headers" section, the organization doesn't have it yet.)
- Tools (read only): `todo` (the admin To do list), `dogs_in_care`, `forms`, `before_training`, `find_dog`, `chat_messages`, `availability`. They live in `lib/claudeConnector.ts`; the MCP part is `app/api/mcp/route.ts`.
- They read with the service key, like the To do list and the daily email, so the key gives admin-level read access. On a Team plan everyone who connects shares it. Keep it in Vercel (Production) and in Claude only.
- They write nothing except one activity log line per call: "Looked up app data through Claude", by "Claude connector", with what was asked (a chat read by id names the dog and client). (`todo` shares the To do page's code, whose only write is its one-time "watching background jobs since" date, already set in production.)
- Off until `CLAUDE_MCP_KEY` is set (32 characters or more). Make one with `openssl rand -hex 32`. To change it: set the new key in Vercel and redeploy, then remove the connector in Claude and add it again with the new header (Claude can't edit a saved header); everyone reconnects.
