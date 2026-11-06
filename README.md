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

### Must haves
Only the **must haves** hold up a dog's start: To do, "Not ready", the client's reminders and `pre_training_missing`. The list is `MUST_KEYS` in `lib/pretrainingFields.ts`: the client's details, address and household, vet and emergency contact, CPR consent, Terms & Conditions, medical conditions, illness in the last 7 days, food, medication, training goals, bite history and aggression towards other dogs. The other questions are still asked on the client's form and show as "optional"; they don't hold anything up.

### Dog names
A dog name on the deal that looks like two dogs ("Francesca & Jack") or like a person ("William Smith" for a Smith) shows on To do with **Fix in HubSpot** and **Keep dog name**. Fixing it in HubSpot clears it within 30 minutes; a kept name is never flagged again.

## Forms before the app (Oct 23, 2026)
`FORMS_CUTOVER` in `lib/reports.ts`. Intake forms and weekly checks due before it were done the old way: the app doesn't ask for them (not late, no penalty). Handover reports due before it are still needed for the client's certificate: they show as "Needed for the certificate" (never late), grouped on To do. Press "Not needed" on any that already went out the old way.

## Sales screen (admin, and sales managers)
`/a/sales`, and `/s` for a sales login on `SALES_MANAGER_EMAILS` (who then sees the whole team as admin does, and nothing else in admin). Above the month's sales by person: the two Chrome extensions (Bark Buster for admin and managers, Sales Assistant for every sales login) with a "How to load unpacked" fold-out; then the comparisons (`lib/salesInsights.ts`, one 25-month pull of Closed Won deals from HubSpot plus a few counts, cached per month for an hour, dropped by Refresh from HubSpot): this month against the same month last year to the same day and in full, against last month to the same day, what last year says about next month, a 13-month strip with last year's months behind, each salesperson (month, last month, same month last year, average deal, days to close, discount, calls and calls per sale), leads and conversion vs last year, days to close, discounting, what sells by program vs last year, lost reasons, payment plans not approved, failed last card attempts (Stripe) and refunds. Both pages show a loading card while the month loads.

## Pulse (dashboard preview)
`/a/pulse`, for admins on `PULSE_EMAILS` (default alma@dogwiseacademy.com); others get a 404. One **snapshot** is built (`buildSnapshot`): the last 90 days plus the 90 before, from the app's tables (every read paged past Supabase's 1,000-row cap), HubSpot (deals created, won, lost, same dates last year, this and next month last year, per-salesperson counts of leads, calls and emails per preset) and Stripe (charges, so "whose last card attempt failed"), squeezed into a compact shape and cached for an hour (`snapshotCached`, tag `pulse`; Refresh rebuilds it). Every range (presets or custom, within 90 days) and view is then worked out from it instantly. Views, switched like the Chats page: **Office** (clients and the link to trainers: Pedro's weekly list, pickups and drop-offs in the range, To do counts), **Trainers** (every active trainer; a score out of 100 = daily updates 40, replies 25, forms 20, alerts 15, parts without data dropped, small samples pulled toward the group; "Low data" and "Unusual for this trainer" flags against the 90-day baseline; a plain-English summary; kennels used, days off) and **Sales** (leads and sold against the same dates last year, conversion vs last year, cost per lead and per sale counted only on deals with Bark credits, "what to beat" this month vs last year, next month last year, a US tile map where the top number is leads, the square fills with sales and a red edge means that state's kennels are 80%+ full, a sales-per-day/week chart against last year filtered by the tapped state, sources with conversion and cost per sale, salespeople with calls and emails). Today's pickups and drop-offs also sit at the top of To do (`lib/moves.ts`).

## Cancel training (dog page)
Asks why (`lib/cancelReasons.ts`, saved on the booking: migration 040) and says plainly who's told: the trainer gets a cancellation with a calendar removal, the office gets a "Training cancelled" alert with the reason, and the kennel frees up. Only for trainings that were really cancelled. The reason isn't in the trainer's email.

## Chat list order
Groups stay as they are; inside each group the newest message is first. "By dates" (`?o=dates`) puts the soonest drop-off / start first instead. The trainer's list is still by dates.

## Closed Won, Standby, Postpone, and progress written to HubSpot
**Closed Won, not booked** (deals won since Oct 11) stays on To do until it's booked, put on **Standby** (a note, then a reminder day or none; writes Client Status = Standby), or **Cancelled** (HubSpot's Cancellation Reason; writes Client Status = Cancelled), or stops being Closed Won. There's no plain Done. A training cancelled in the app whose deal is still Closed Won (and not Cancelled / Standby / Refunded) comes back as "Cancelled in the app, still Closed Won in HubSpot". **Dogs → Standby** lists every Closed Won deal with Client Status = Standby in HubSpot (any date) with the app's note and reminder (table `standby`, migration 043); a reminder comes back as a To do on its day. **Postpone** on the dog page frees the booking (the trainer is told), puts the deal on Standby and sets "Drop off postponed" (by client's / trainer's request). Cancelling a training in the app now writes Client Status = Cancelled, the Cancellation Reason (the app's reasons are HubSpot's list) and Cancellation Info. Every 30 minutes `lib/programSync.ts` writes each live program's progress to its deal: Pick Up Confirmation, Trainer Intake Form, Weekly Report #1–6 received (Yes / Sent w/ delay / No / N/A), Handover received + date, Drop Off Confirmation, Start Follow Up Management, Ongoing, Needs Attention Status, Client Status (forward only), Point of Contact (when the trainer's POC matches a HubSpot name). Only changed values are written, a recorded Yes is never downgraded, forms due before the cutover are left alone, and deals marked Cancelled / Refunded / After Graduation Support aren't touched.

## Dogs: rows in words, Views, Filters
Each dog is one card (`components/DogRows.tsx`, wording from `lib/dogStatus.ts`): a dot that means one thing (red = something's wrong, amber = needs a look, green = on track, grey = nothing to do), the headline ("Starts Sun, Nov 8, in 5 days" / "Day 6 of 21 · home Nov 22" / "Pickup not confirmed" / "Home Nov 1 · Follow-ups: 1 done of 3"), what needs doing ("Week 2 report missing · $2,000 owed"), and the forms so far with ✓ / ✗ (forms from before the app are left out; only the next one ahead is shown). Before-training gaps only show on Upcoming; "Paid" isn't shown, only what's owed. Colours are real green / amber / red (`ok`, `amber`, `bad` in the theme, light and dark).

The toolbar is Search · Views · Filters. **Filters** work like HubSpot's: "Add filter", pick a field (trainer, point of contact, start date, end date, vaccines, before-training forms, balance, pickup, weekly reports, handover report, follow-ups, client's state, program), set it; every condition is a row and all must match. Dates can be relative (today, this weekend = Thursday to Wednesday, this week, next week, next 7 / 14 days, this month, last 7 days), on a date, or between two. **Views** (`dog_views`, migration 047) are named tabs + filters shared by the office: it starts with the office's HubSpot reports, anyone can save what's on screen or remove a view, and relative dates keep saved views right. The Program list is HubSpot's Type of Program Sold. Export CSV gives exactly what's on screen.
## A different trainer for the follow-ups
Migration 046. On the dog page (Follow-up sessions), "Who does the follow-ups?": another trainer joins the dog's chat (the program trainer stays in it; `chats.extra_trainer_ids`, and `chat_access` lets them in), sees the dog in their Past dogs, books and logs the follow-ups, gets the chat's notifications, and is paid for each session. The program's own pay doesn't change. Changing the program trainer itself (whole booking, or from a date mid-training) is still Change trainer, up to drop-off.

## Assign or Ask (OPS 08)
Migration 048, `lib/lanes.ts` (the rules, pure and tested), `lib/laneData.ts` (real data, the booking gate, asks). For a Closed Won deal (its start date, weeks, program, dogs, ZIP and sold date), each nearby trainer is in one lane: **Assign** (Book now, tell the trainer), **Check first** (a bonus dog on any night of the program, pickup in 3 days or less, or the trainer on Watch: "They said yes" books it; "Ask them for me" puts a To do with a deadline in front of the trainer's POC), **Ask Pedro** (on probation, or the client outside their range: a To do and an email to `PEDRO_EMAIL` with the dog, program, dates, distance and why; once Pedro approves, Book now unlocks for that trainer on that deal), greyed (doesn't take the program; trainer profile → Booking rules → Programs they take), or hidden (Hold). A small ★ Preferred marks the more responsive trainer only on a genuine tie (same lane, both free, within 15 mi / 15%). The same lanes show in the booking picker and the Sales Assistant (`GET /api/lanes?deal=`, `POST /api/asks`), and both booking paths refuse what needs a check (409 `ask_pedro` / `check_first` for the extension); each booking records its lane. An offer past its deadline becomes "No reply: re-match" (no reply = no); a trainer silent on two offers in 60 days goes to Pedro; "No one else fits" on an offer sends it to Pedro. Trainer profile → Booking rules: Status (Active / Watch / Hold) and Programs they take (none ticked = all).

## HubSpot deal fields filled from the app (no copying by hand)
From the client's answers (every 30 minutes, with the Forms ticks): **Main goal notes** ("Jumping;Door manners;…"), **Food** (the brand), **Medication** ("No", or what they wrote); two or more dogs as "Rex: … | Bella: …". From the app (the progress sync, for bookings up to 60 days ahead): **Items** (the trainer's intake form), **Group Created** = Yes once the dog's chat exists, **Is Client in the group?** = Yes once the client has opened their chat, No until then ("Doesn't have the app" is left alone), **Signal Group link** = the dog's chat in the app, **Enrol in After Sale Follow up** = Start once the handover is in (a Stop is left alone). The app's values win. Already automatic: Forms, Vaccines in order?, Missing vaccines, Remaining Balance link. The two **Forms** boxes now tick when everything needed to start is in (questions that don't hold up the start, like "Barks at people?", still show as optional on the dog page), and **Vaccines in order? = Yes** set in HubSpot counts in the app even when uploaded records are waiting for a check.

## Pickup and drop-off are confirmed, not assumed from dates
Migration 045 (`bookings.picked_up_at / dropped_off_at`, `lib/moveRules.ts`, `lib/pickup.ts`). A pickup counts once the trainer taps **Picked up** on their Today card, the intake form comes in, or the office presses **Mark picked up** (dog page or To do); a drop-off the same with **Dropped home** / the handover report / **Mark home**. Anything that started or ended before Nov 1 counts as done (the past). Until then the dog stays in **Upcoming** (or **In care**) on Dogs, with a red "Pickup not confirmed" once its day has passed, and HubSpot stays **Not started** (or Ongoing): Client Status, Pick Up / Drop Off Confirmation and the health field follow the confirmations, never the dates. The trainer gets one push at 5 PM in their time (from their state) on the day; "Not yet" asks for the new day and why and tells the office; the morning after, an unconfirmed one is a To do with Mark / Postpone / Cancel on it (a HubSpot "no start date" problem offers Postpone / Cancel too). The progress sync undoes the app's own early changes: when HubSpot's history shows the app made the last change (since Nov 2) and the dog isn't actually picked up, it puts back the value from before; a person's change is never touched. Dates on HubSpot date fields are compared as days, so they're written once. Pay, mileage and form deadlines still follow the booked dates.

## Dogs: the program at a glance, POC filter, Export CSV
Every row on Dogs shows a strip (`lib/programStrip.ts`): **I** intake · **W1–W6** weekly reports · **H** handover · **F1–F3** follow-ups, green in / amber late or asked / red missing / blue booked / outline not due / grey before the app, and **Paid** or **$X owed** from the deal. The trainer's POC and a cancellation's reason show under it. **POC** chips filter by the trainers' Point of Contact. **Export CSV** downloads whatever chip, trainer, POC and search is showing, with the deal, client, trainer, POC, program, dates, before-training status, amount / paid / owed / payment status, salesperson, every form and follow-up in words, cancel reason and the HubSpot link: the views the office used HubSpot reports for.

## Follow-up sessions (3 per program)
Migrations 043 + 044, `lib/followups.ts`, `app/followup-actions.ts`. Once the handover report is in, the client's chat gets a one-time message and a **Book your follow-up** card (session n of 3): they pick up to 3 days with a part of the day, and it's posted in the chat as their message, so the trainer is notified as usual and sees a "asked for a follow-up" banner in the chat. The trainer's **Follow-up sessions** page (from their past dogs) confirms one of the client's days with a time, or sets a session up directly, changes or cancels it: the date goes into HubSpot (Follow Up Session #n, and the pay side at once), the client gets the time in the chat and a reminder the day before (a scheduled message). **Log a follow-up session** asks whether it happened and how long, and fills FUP #n Completed / Duration / Comments (and Client Status "Completed with Follow up"). A missed or cancelled session can be booked again. The office gets a To do if a request waits 24 hours or a past session isn't logged within 2 days, and sees each session's status on the dog page.

## Closest trainers (booking page and the Sales Assistant)
Once a deal loads on Book a dog, the 5 closest trainers to the client's ZIP (the pickup address's ZIP if different, else the client's, else the deal name's) show above the Trainer box, in the Sales Assistant's order (covers the client and has room first), each with **Route** (driving miles one way, from FreeRoute) and **Straight** (as the crow flies), their range and next opening, and Pick. `/api/availability` adds `routeMiles` whenever 10 or fewer trainers are asked for (`&routes=0` skips it), each pair cached 30 days; anything slower than 9 s is left out. The FreeRoute keys live only in Vercel: `FREEROUTE_API_KEY`, and optionally `FREEROUTE_API_KEY_2` as a second one. Key 1 is used until FreeRoute refuses it (429 out of requests, 401/403 wrong or revoked), then key 2 until midnight Eastern; with both refused, nothing more is sent that day and distances fall back to straight-line (mileage checks to the ×1.25 estimate, tried again later). The extension gets the miles from the app.

## Client emails: getting people in
The invite (once, when the chat opens) has a 30-day one-click button and a simple password. The daily "New updates" email (at most once a day, 9 AM–8 PM ET, only with something unread for 90+ minutes) says "Not signed in yet? Click here": a fresh 14-day one-click link, which is also the main button for clients who have never opened the chat. Two days after the invite, a client who still hasn't opened the chat gets one "[dog]'s chat is ready for you" email with the same kind of link (migration 042, `chats.join_reminded_at`, so it's sent once). Both respect "stop these emails" and Quiet chats.

## Deleting a chat message
Under each message: **Delete** (trainers on their own messages, the office on any). It removes the message for everyone (open chats drop it live) and moves its photos, videos and files to the Drive trash, so the folder link stops showing them too. Logged as "Deleted a chat message". Before a trainer or the office sends a document (anything that isn't a photo or video), the app asks whether it's meant for the client.

## Scheduled messages (trainers and the office)
Migration 041. The clock next to Send opens a sheet: write the message, add photos or videos, pick when (quick picks or any date and time, up to 30 days ahead). It's kept in `scheduled_messages` and posted into the chat by the 10-minute chat job (`lib/scheduled.ts`) at that time, as the person who scheduled it, so the client sees nothing before (no message, preview or notification). Pending ones show in a "Scheduled" strip above the composer with Cancel (yours, or any as admin). If the chat closes first, it's cancelled with a note.

## Quiet chats (finishing on Signal)
Migration 039. On a chat page (or a To do row for "hasn't posted" / "client waiting"), **Quiet chat** stops that chat's "hasn't posted today", "client waiting" and "unanswered messages" alerts (and clears open ones), its client "new updates" emails and its automatic invite. Messages still notify as normal if anyone posts. Only the emails in `QUIET_CHAT_EMAILS` (default alma@dogwiseacademy.com) see the button, and the server checks it; everyone else sees "Quiet: finishing on Signal". **Alerts back on** undoes it.

## Dark mode
**Your account → Appearance** (admin and sales), or the trainer's Profile page: Light (default) or Dark. Saved on that device (localStorage `dw-theme`) and set before the page paints, so it doesn't flash light first.
- Every colour is a CSS variable in `app/globals.css` (light under `:root`, dark under `[data-theme="dark"]`); `tailwind.config.ts` explains the rules. Every text/background pair in the app passes 4.5:1 in both themes.
- Must stay white in both themes (white documents with their own dark text): use `bg-[#fff] text-[#281870]`, as the payslip and report previews do.
- The logo has a light version for dark mode (`public/brand-logo-dark.png`, via `components/BrandLogo.tsx`). Free kennels show as outlined boxes in dark mode, booked ones filled.

## Mileage check (payslips)
Each payslip has a **Mileage check**: every pickup, drop-off and follow-up trip in the period, the miles the trainer declared, the driving route from the trainer to the client (doubled for the round trip), and a **Check on Google Maps** link for the same trip.
- Flags: more than 5% **or** 15 miles over the route, or any trip that earns mileage pay (over the trainer's free miles). Pay is still worked out from the declared miles; fix the line by hand if it's wrong. The payslip cards show how many trips to check.
- Routes come from FreeRoute (`FREEROUTE_API_KEY` in Vercel; free tier 1,000 requests a day, we use a few). Its address search can pick a same-name town in another state, so an address only counts when the result is in the same ZIP (or state); otherwise the ZIP's centre is used. If FreeRoute errors or doesn't answer, it's a straight-line estimate + 25% for roads, marked "estimate", tried again 6 hours later. No key = estimates only. FreeRoute doesn't report tolls; Google does, on the link.
- One check per booking and trainer, kept in `trip_routes` (migration 038), redone only when an address changes. The 20-minute forms job checks a few at a time; **Check now** on the payslip does that trainer's trips straight away.

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
The app is a custom connector in Claude, so whoever adds it can ask Claude about bookings, chats and forms.
- Address: `https://<app address>/api/mcp`. In the connector's settings choose "No sign-in" and add the request header `Authorization` with the value `Bearer <CLAUDE_MCP_KEY>`. (Request headers are still a beta in Claude: if the dialog has no "Request headers" section, the account doesn't have it yet.)
- Tools (read only): `todo` (the admin To do list), `reminders` (the reminder ladder: what's still being chased, how each trainer responded, the office's check-ins), `dogs_in_care`, `forms`, `before_training`, `find_dog`, `chat_messages`, `availability`, and for communication: `chats` (every open chat and team thread, with who is waiting on whom and for how long), `recent_messages` (what was said since a given time, across all chats and team threads), `trainer_comms` (each trainer's daily updates and reply times over the last days) and `pulse` (Pulse's office, trainers and sales figures for the last 7, 14, 30 or 90 days, from the same snapshot as the page, with what Pulse says needs a decision). They live in `lib/claudeConnector.ts`, `lib/claudeComms.ts` and `lib/claudePulse.ts`; the MCP part is `app/api/mcp/route.ts`.
- They read with the service key, like the To do list and the daily email, so the key gives admin-level read access. Keep it in Vercel (Production) and in Claude only.
- They write nothing except one activity log line per call: "Looked up app data through Claude", by "Claude connector", with what was asked (a chat read by id names the dog and client). (`todo` shares the To do page's code, whose only write is its one-time "watching background jobs since" date, already set in production.)
- `pulse` reads Pulse the way the page does, but the page is only for the emails in `PULSE_EMAILS`, while anyone using the connector can call `pulse`. Set `PULSE_CONNECTOR=off` in Vercel to take it off the connector. A call is quick while Pulse's snapshot is fresh (it is kept for an hour); one that has to take the snapshot again waits on HubSpot, so `pulse` gets 50 seconds instead of 25.
- Off until `CLAUDE_MCP_KEY` is set (32 characters or more). Make one with `openssl rand -hex 32`. To change it: set the new key in Vercel and redeploy, then remove the connector in Claude and add it again with the new header (Claude can't edit a saved header).

## Reminders to trainers (the reminder ladder)
The app reminds the trainer itself; the office only gets what the trainer didn't act on after 2 reminders (`lib/nudges.ts`, run by the 10-minute chat check; migration 049).
- **Daily update**: 6 PM Eastern, a reminder listing the dogs with no post yet that day; the next day at 6 PM, a second one; at 8 PM that day (2 days missed) it's on To do: call the trainer. The 8 PM Eastern cut-off is unchanged.
- **Client waiting**: reminders at 3 and 6 waking hours (8 AM to 9 PM Eastern); on To do at 12 waking hours, as before. Only a person's reply counts: the app's automatic posts (training videos) no longer clear a waiting client.
- **Late form**: reminders at 10 AM the 2 mornings after the deadline; on To do the morning after that ("Form late after 2 reminders").
- Reminder 1 is a phone notification (a text, or an email, when the trainer's phone doesn't get the app's notifications). Reminder 2 adds a text. One message per trainer covers all their dogs. Nothing goes to a trainer outside 8 AM to 9 PM their time (time zone from the state on their profile).
- Everything clears itself when the post, reply or form comes in, so these To do items have no Done button. They show what the app already sent, and **Call** / **Message**: a suggested message the office can change, sent in the trainer's Dogwise team thread (or as a text). Each check-in is logged with whether the suggestion was sent as it was.
- Trainers see the same things on Today, under **To do today**: who's waiting on them (with their words), the dogs that still need today's update, and forms. Each row opens the chat or form and drops off once it's done.
- Pulse grades chasing (15 of the 100): the reminders the app had to send, plus 3 for each time the office stepped in, per 7 dog-days.
- Vercel: `NUDGES=off` stops the ladder (and brings back the old evening "hasn't posted" flags). Texts need `QUO_API_KEY` and `QUO_FROM` (a local Quo number, +1XXXXXXXXXX; `QUO_API_URL` only if Quo's API address changes). Test it signed in as an admin: `/api/quo/test?to=+1XXXXXXXXXX`. Without Quo, reminders that would be texts go by email.
- Sean's Claude (Communication Tower): the instructions it should follow are in `docs/comms-agent.md`.
