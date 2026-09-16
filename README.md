# FRADY OS

A private personal operating system for projects, tasks, events, social content, deadlines and the things you are waiting on other people for. One place that answers:

- What should I work on today?
- What is due soon or overdue?
- What events are coming up, and what do I need to prepare?
- What social posts need to be drafted, approved or published?
- Who am I waiting on, and when should I follow up?
- What have I accomplished this week?

Built with Next.js 16 (App Router, Server Actions), TypeScript, Tailwind CSS v4, shadcn-style UI components, and Supabase (Auth, Postgres with row-level security, Storage). Deploys to Vercel.

## Features

| Area | What you get |
| --- | --- |
| **Today** | Top three priorities (manually chosen), overdue, due today + next 7 days, planned-for-today, upcoming events with outstanding prep, social deadlines, follow-ups due, recently completed. |
| **Projects** | Grouped by customizable work areas (ARI, Northwestern Mutual and Personal are seeded). Status, priority, target date, next action, links, progress from completed tasks, overdue/waiting counts, related tasks/events/posts/notes/attachments. |
| **Tasks** | Inbox → To Do → In Progress → Waiting on Someone → Completed. Priority, planned work date separate from deadline, due time, estimated effort, subtasks, notes, links, attachments, recurrence, full status history. List, board (drag between columns) and calendar (drag moves the *planned* date only). Completed tasks are preserved and can be reopened. |
| **Waiting On** | Person, what you need, date requested, their expected delivery date, your next follow-up date, last follow-up, notes. Late deliveries and follow-ups due today are highlighted. Record follow-up, reschedule, mark received. Nothing is ever sent automatically. |
| **Events** | Manual events plus read-only import from one Monday.com board with column mapping discovered from the board schema (Date and Timeline columns supported). Stable item ids prevent duplicates; canceled/removed items are flagged for review, never deleted; date changes are recorded and local work is never touched. |
| **Event prep & social** | Each event has a preparation checklist and social plan. Reusable templates with editable milestones/offsets and a preview before creation. If an event moves, unfinished template-based items get *proposed* new dates you accept or keep; completed work and manually overridden dates are never changed. Social posts are one record shown everywhere (dashboard, event page, task views, calendar). |
| **Calendar** | Month / week / agenda with events, deadlines, planned work, follow-ups, expected deliveries and social publish/draft/approval dates. Filters and presets (Everything, Content, My work). Monday.com dates are read-only. |
| **Completed** | Tasks completed this week/month, projects completed, posts published, carry-over into next week, weekly summary grouped by project or work area, copy-to-clipboard and CSV exports. Generated from real records only. |
| **Reminders** | Deduplicated in-app notifications for approaching deadlines, overdue tasks, follow-ups and social milestones, with configurable lead times. Optional daily email digest once an email service is connected. |
| **Search** | ⌘K / `/` searches projects, tasks, events and posts. `N` opens quick add from anywhere. `?` lists shortcuts. |

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Apply the migration in `supabase/migrations/0001_init.sql`. Either paste it into the SQL editor, or with the Supabase CLI:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   The migration creates every table with row-level security (each user only sees their own rows), a private `attachments` storage bucket with owner-only policies, a trigger that bootstraps a new user's profile, default work areas and a starter event template, and the `search_workspace` function.
3. In **Authentication → URL configuration**, set the Site URL to your deployment URL and add `http://localhost:3000/**` and `https://<your-domain>/**` as redirect URLs.
4. In **Authentication → Email templates**, change the *Confirm signup* and *Magic link* templates to use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` (signup) and `...&type=magiclink` (magic link) so the server-side confirm route can exchange the token.

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Publishable (or legacy anon) key |
| `SUPABASE_SECRET_KEY` | for scheduled jobs | Secret/service-role key, server-only, used by the cron routes |
| `CRON_SECRET` | for scheduled jobs | Long random string; Vercel sends it as a bearer token to cron routes |
| `MONDAY_API_TOKEN` | optional | Personal API token; leaving it blank keeps the integration clearly disconnected |
| `NEXT_PUBLIC_SITE_URL` | optional | Public origin for auth emails |
| `ALLOW_SIGNUP` | optional | Sign-ups are closed unless `true`. Add users from Supabase → Authentication → Users instead. |
| `LOGIN_USERNAME`, `LOGIN_EMAIL` | optional | Lets you type a short username on the sign-in form instead of the email |
| `RESEND_API_KEY`, `REMINDER_FROM_EMAIL` | optional | Enables the email digest toggle in Settings → Reminders |

### 3. Run locally

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # next typegen + tsc
npm run lint
npm test           # vitest unit tests
npm run build
```

Sign in with email + password (or a magic link). The first sign-in bootstraps your workspace. Sign-ups are closed by default; create your account under Supabase → Authentication → Users → Add user, or set `ALLOW_SIGNUP=true` temporarily.

### 4. Deploy to Vercel

Import the repository, add the environment variables above, and deploy. `vercel.json` schedules two jobs:

- `/api/cron/monday-sync` — daily at 11:00 UTC (6/7 am Indiana). Syncs every connection with scheduled sync enabled.
- `/api/cron/reminders` — daily at 11:30 UTC. Generates reminders and sends email digests when enabled.

Both routes reject requests that do not carry `Authorization: Bearer $CRON_SECRET`. On a Vercel Pro plan you can make the schedules more frequent (for example `0 * * * *`); the Hobby plan allows one run per day per job.

## Monday.com integration

1. Add `MONDAY_API_TOKEN` to the server environment. The token never reaches the browser.
2. Settings → Monday.com → **Test connection & load boards** → pick the board.
3. Map the board's actual columns to event name, start/end dates (Date or Timeline), location, program, owner, status, website and notes. Sensible defaults are suggested from the schema; every mapping is editable. Choose which status labels mean "canceled".
4. **Sync now**, or leave scheduled sync on. The connection shows the last successful sync time and the last error.

### Real-time updates via webhook

Set `MONDAY_WEBHOOK_SECRET` (any random string, 16+ characters), redeploy, then open Settings → Monday.com. The card shows the URL `https://<your-domain>/api/webhooks/monday?token=<secret>`. Either paste it into Monday's "Send a webhook" recipe (Integrations → Webhooks; the endpoint answers the challenge handshake automatically) or click **Register webhooks automatically**, which creates recipes for item created, column changed, name changed, item deleted, archived and restored. Each webhook call re-runs the same read-only sync, coalesced so a burst of edits triggers one run. Monday does not sign webhook bodies, which is why the secret lives in the URL.

How sync behaves:

- Monday.com is the source of truth for imported fields; they are read-only in FRADY OS.
- Matching is by board id + item id, so re-running never duplicates.
- Changed dates/status are reflected; the previous dates are kept until you acknowledge them, and unfinished template-based prep/social items get proposed new dates for review.
- Items whose status matches a canceled label, or that disappear from the board, are flagged for review. Your tasks, notes and posts are never deleted by sync.
- Program values that match a work area name are auto-assigned the first time an item is imported.
- A `program` value can be re-mapped manually per event under "My local settings".

## Time zones and dates

All deadlines, planned dates and event dates are stored as Postgres `date` values and handled as `YYYY-MM-DD` strings end to end, so they never shift through UTC conversion. "Today" is computed in the user's time zone (default `America/Indiana/Indianapolis`, editable in Settings). Timestamps (created/completed/synced) are `timestamptz` and displayed in the user's zone.

## Project structure

```
supabase/migrations/      SQL schema, RLS policies, storage policies, bootstrap trigger
src/app/(app)/            Authenticated pages: Today, Projects, Tasks, Waiting On, Events, Calendar, Completed, Settings
src/app/api/cron/         Protected scheduled endpoints (Monday sync, reminders)
src/app/api/export/       CSV export
src/actions/              Server Actions (all writes; zod-validated; RLS-scoped)
src/lib/data/             Server-side read models
src/lib/monday/           Monday.com GraphQL client, column mapping, sync engine
src/lib/dates.ts          Time-zone-safe date-only helpers
src/lib/recurrence.ts     Recurring task rules
src/lib/templates.ts      Template preview and event-move proposals
src/lib/notifications.ts  Deduplicated reminder generation
src/components/app/       App shell, editors, dialogs, shared rows
src/components/ui/        shadcn-style primitives
```

## Security notes

- Every table has RLS policies restricted to `auth.uid()`; the storage bucket only allows paths that begin with the user's id.
- Server Actions re-check the session on every call and scope every query by `user_id`.
- Secrets (`SUPABASE_SECRET_KEY`, `MONDAY_API_TOKEN`, `RESEND_API_KEY`, `CRON_SECRET`) are server-only.
- External data from Monday.com is validated (dates, URLs, lengths) before it is stored.
