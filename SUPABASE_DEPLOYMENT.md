# Supabase and Cloudflare Pages deployment

## 1. Create the Supabase project

1. Create a new Supabase project in the existing organization.
2. In **Authentication > Providers > Email**, keep email authentication enabled.
3. In **Authentication > URL Configuration**, set **Site URL** to the final Cloudflare Pages URL. Add local preview and production URLs to **Redirect URLs** as needed.
4. In **Authentication > Email Templates > Magic Link**, replace the message body so it displays `{{ .Token }}`. The site verifies this numeric token with `verifyOtp`; it does not use a magic-link redirect.
5. Before accepting paid users, configure a production SMTP provider in **Authentication > SMTP Settings**. Supabase's default mail service is only suitable for limited testing.

## 2. Create the database schema

Open the Supabase SQL editor and run every file in `supabase/migrations/` in filename order. For a project that already ran the first migration, run the second migration now:

```sql
-- First project setup:
-- supabase/migrations/202608040001_member_question_access.sql
-- Existing project patch:
-- supabase/migrations/202608050002_grant_admin_import_access.sql
-- Lazy course cache catalog:
-- supabase/migrations/202608050003_question_bank_catalog.sql
-- Question chapter metadata:
-- supabase/migrations/202608080004_question_chapter_assignments.sql
-- Immutable editorial quality, revisions and publication RLS:
-- supabase/migrations/202608090005_question_editorial_quality.sql
-- Manual payment orders and atomic membership approval:
-- supabase/migrations/202608090006_purchase_orders.sql
-- Order recovery experience and exact approved expiry:
-- supabase/migrations/202608110007_order_experience.sql
-- Supabase pgcrypto schema compatibility for new question imports:
-- supabase/migrations/202608110008_fix_question_quality_digest.sql
-- Private feedback inbox:
-- supabase/migrations/202608110009_user_feedback.sql
-- Public-write rate limits and correction evidence:
-- supabase/migrations/202608110010_production_hardening.sql
```

The migrations create `memberships`, `questions`, `question_bank_catalog`, `question_quality`, `question_revisions`, and `question_quality_events`, enable RLS on every business table, grant no browser write permissions, and permit catalog and published-question reads only through `public.is_active_member()`.

The fourth migration adds chapter metadata to `questions`. It does not alter question stems, answers, analyses, order, or RLS. `verified` is reserved for editorially checked assignments; `candidate` is a visible, non-final rule result.

The fifth migration seeds one quality row per existing question, makes `questions.payload` immutable, and changes question RLS so active members can read only `publication_status = 'published'` rows. Current display corrections live in `question_revisions`; normal authenticated users cannot write quality, revisions, or audit events.

Run the fifth migration before deploying the matching frontend. The new frontend requires `question_quality` and reads current revisions before writing a course to IndexedDB.

Run `202608110007_order_experience.sql` before deploying the matching order-status frontend. It adds the approved order's exact `membership_expires_at` and replaces the approval RPC without changing its service-role-only permission or idempotent membership extension rules.

Run `202608110008_fix_question_quality_digest.sql` before appending new questions. It only rebuilds the question-quality insert function so SHA-256 hashing resolves from Supabase's `extensions` schema; it does not replace or edit existing question rows.

Run `202608110010_production_hardening.sql` after the feedback migration and before deploying the matching frontend. It creates a server-only atomic rate-limit table/RPC and adds feedback correction evidence fields. It does not modify question payloads, answers, analyses, ordering, memberships, or orders.

## 3. Local environment and question import

Keep the original source files in the local `data/question-bank-source/` directory. It is intentionally ignored by Git and must not be uploaded to Cloudflare Pages or a public repository.

```powershell
Copy-Item .env.example .env
# Fill SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env for this terminal only.
$env:SUPABASE_URL = "https://your-project-ref.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key"
npm run import:questions
```

The importer also updates `question_bank_catalog`. It calculates a stable SHA-256 hash for each course's ordered question payload and changes the catalog version only when that course content changes. Run the import again whenever question content is changed; the browser will re-download only courses whose catalog hash changed.

For an existing project whose `questions` table is already populated, create the catalog rows without deleting or re-importing those questions:

```powershell
npm run import:questions -- --catalog-only
```

The importer refuses to overwrite an existing question table. `--replace` is disabled after the immutable editorial migration; preserve existing rows and use the append or revision workflows below.

To add only the repository's curated supplement without changing or deleting existing question rows, use:

```powershell
npm run import:questions -- --append-curated
```

This mode checks question stems for duplicates, appends only missing curated questions at the end of each course and question type, then recalculates catalog counts and hashes from the database. It also includes the reviewed questions generated from the repository's 2023 textbook knowledge-point structure.

When a reviewed correction affects only the curated supplement, create a display revision without touching `questions.payload`:

```powershell
npm run import:questions -- --sync-curated
```

After the fifth migration, generate and verify the full editorial manifest. The first command writes only to the Git-ignored local source directory; the second and third commands are read-only:

```powershell
npm run verify:payloads
npm run questions:audit-quality
npm run verify:editorial-quality
npm run questions:sync-quality
```

Review `data/question-bank-source/editorial-quality-report.json`, then explicitly apply the manifest with the local service-role key:

```powershell
npm run questions:sync-quality -- --apply
```

The apply command verifies every database payload hash before writing, creates or reuses non-destructive revisions, updates publication/source/chapter quality metadata, and refreshes `question_bank_catalog`. It never updates `questions.payload`. Exact answer-equivalent duplicates may be hidden and linked to a canonical row; reviewed cross-course or malformed source records use `hidden_review`; semantic near-duplicates and low-confidence chapter matches remain review candidates.

For this content-quality release, run `202608110008_fix_question_quality_digest.sql` first. With the service-role environment available locally, deploy the content in this order:

```powershell
# 1. After running migration 202608110008, append only missing reviewed additions.
npm run import:questions -- --append-curated

# 2. Preview, then apply publication/source/chapter/revision metadata.
npm run questions:sync-quality
npm run questions:sync-quality -- --apply

# 3. Verify published coverage and the live database.
node scripts/verify-question-coverage.js --strict
npm run verify:editorial-sample
npm run verify:database
```

The quality sync refreshes `question_bank_catalog`; changed hashes invalidate only the affected per-course IndexedDB caches.

After running the fourth migration, review the local candidate report first. The write mode changes only rows that are still `unclassified`; it never changes `verified` assignments or question content. It also recalculates `question_bank_catalog` so browser caches refresh their chapter labels.

```powershell
# Read-only candidate coverage report
npm run questions:chapters

# Write candidate metadata after editorial approval of the rules
npm run questions:chapters -- --apply-candidates
```

Before release, run the read-only structural check. It rejects exact duplicate stems within a course and type, missing answers, invalid choice answers, and single/multiple-choice label mismatches:

```powershell
npm run verify:database
```

## 4. Member management

All three scripts require `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the local shell. Do not put the service role key in Cloudflare Pages.

```powershell
# Create/find the auth user and grant 30 days of membership.
npm run member:add -- student@example.com 30

# Extend membership to a specific time, or pass a number of additional days.
npm run member:extend -- student@example.com 2026-12-31T23:59:59+08:00

# Stop access immediately.
npm run member:revoke -- student@example.com
```

`member:add` has a 300 active, unexpired member limit. Renewing an already active member remains allowed. When the limit is reached, the script refuses to create or activate another account and asks the administrator to check **Supabase Dashboard > Usage** before changing the operating limit.

## 5. Cloudflare Pages

Set the project build settings:

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js version: `22` or later

Set these environment variables in **Cloudflare Pages > Settings > Environment variables** for both Production and Preview as appropriate:

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_EMAILS=admin1@example.com,admin2@example.com
TURNSTILE_SITE_KEY=your-turnstile-site-key
TURNSTILE_SECRET_KEY=your-turnstile-secret-key
RESEND_API_KEY=re_your_api_key
FEEDBACK_NOTIFY_EMAIL=admin@example.com
FEEDBACK_FROM_EMAIL=feedback@your-domain.example
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `TURNSTILE_SITE_KEY` are build-time browser-safe values. `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`, and `TURNSTILE_SECRET_KEY` are read only by Cloudflare Pages Functions at runtime. Do not use a `VITE_` prefix for server-only values, do not put them in `.env` committed to Git, and do not expose them in browser code. Vite inserts only the three browser-safe values above into the built client.

Create one Turnstile widget in **Cloudflare Dashboard > Turnstile** and allow the production Pages hostname plus any preview hostname you actually use. Set `TURNSTILE_SITE_KEY` as plain text and `TURNSTILE_SECRET_KEY` as an encrypted secret in both Production and Preview. The browser receives only the site key. The secret is used only by Pages Functions. Order creation is limited to 5 attempts per IP/email per hour and feedback to 20 attempts per IP per hour; only a one-way request fingerprint is stored.

The three feedback email variables are optional and server-only. `RESEND_API_KEY` authenticates Resend, `FEEDBACK_NOTIFY_EMAIL` accepts one or more comma-separated recipients, and `FEEDBACK_FROM_EMAIL` must use a sender domain verified in Resend. Without all three variables, feedback is still stored and visible in the admin inbox, but no email is sent.

## 6. Manual payment membership

After running `supabase/migrations/202608090006_purchase_orders.sql` and `supabase/migrations/202608110007_order_experience.sql`, the public paths are `/buy`, `/pay/:orderNo`, and `/order/:orderNo`. Existing `assets/alipay.jpg` and `assets/wechat.jpg` are deployed as:

```text
public/payment/alipay-qr.jpg
public/payment/wechat-qr.jpg
```

Replace only those two files if the real collection codes change. Do not generate placeholder QR codes.

Set `ADMIN_EMAILS` to the comma-separated email address(es) that can use `/admin/orders`. Each administrator must first log in through the existing email OTP flow. The browser sends only that existing session token; Cloudflare verifies the token and compares its email with `ADMIN_EMAILS` server-side.

Payment flow: a buyer creates one `pending_payment` order for `¥9.90 / 30 days`, submits a payment method and the last six payment-order characters, then the order becomes `pending_review`. An administrator checks the actual payment and selects **确认付款并开通**. Only then does the protected server function create or reuse the Supabase Auth user for that order email. The SQL function locks the order, adds 30 days to a current active expiry or starts from database `now()` when new/expired, then marks the order approved. Repeating approval for the same order returns `already_processed` and does not add time again.

The browser retains each private order access token on that device for at most 60 days so an unsigned buyer can recover an unfinished order. The status page refreshes a `pending_review` order every 20 seconds, exposes copy controls with a private-link warning, and displays the exact expiry saved by migration `202608110007` after approval.

Run this verification before deployment:

```powershell
npm run verify:payments
```

## 7. User feedback inbox

Run `supabase/migrations/202608110009_user_feedback.sql` in the Supabase SQL Editor after all earlier migrations. It creates the private `feedback` table, enables RLS, removes all direct `anon` and `authenticated` access, and grants access only to the service role used by Pages Functions.

Users submit feedback inside the existing dialog without a GitHub account. The public endpoint accepts only the five displayed feedback types, validates lengths, stores optional signed-in account context, and never returns other users' feedback. Administrators use `/admin/feedback`; the existing OTP session and `ADMIN_EMAILS` server-side check protect both listing and status changes.

For email alerts, create a Resend API key, verify the domain used by `FEEDBACK_FROM_EMAIL`, set the three optional variables above in Cloudflare Pages for Production, and redeploy. The database inbox remains the source of truth: a Resend outage does not make a submitted feedback disappear.

Run this verification before deployment:

```powershell
npm run verify:feedback
```

When a report concerns a question, the inbox records the stable question ID. Marking it `待修正` sends the associated quality record to manual review. Marking it `已修正` is allowed only after a current immutable question revision exists, and records both the revision ID and current course catalog hash. This prevents a feedback item from being closed as fixed without a traceable published correction.

## 8. Content QA and private backups

Run the aggregate content checks before a content release. The command reuses the existing audit and verification scripts and writes a Git-ignored summary to `tmp/content-qa-report.json`:

```powershell
npm run content:qa
```

Create a private JSON backup before migrations, bulk question imports, or quality syncs:

```powershell
$env:SUPABASE_URL = "https://your-project-ref.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key"
npm run backup:supabase
```

The backup includes memberships, orders, feedback, questions, catalog, editorial quality/revisions/events, and a minimal Auth user identity map. It writes SHA-256 checksums to `backups/<timestamp>/manifest.json`. The entire `backups/` directory is ignored by Git and must be stored privately because it contains account and business data. Restore is intentionally a reviewed manual operation; do not blindly import a backup over production.

## 9. Required acceptance checks after deployment

1. An unsigned browser only sees the email OTP screen.
2. An unknown email is rejected because the client sends `shouldCreateUser: false`.
3. A member email receives an OTP and can enter the site.
4. An active, unexpired member sees the five course counts from `question_bank_catalog`; opening a course loads only that course's questions in 100-row pages.
5. A missing, revoked, or expired `memberships` record cannot load any rows.
6. In the Supabase API docs or SQL editor, test an anon `select` against `public.questions`; it must return no rows because of RLS.
7. Run `npm run build` and `node scripts/verify-production-build.js` before every production deployment.
8. Run `npm run verify:lazy-cache`; it verifies account isolation, version invalidation, logout cache deletion, and the lazy-loading contract.
9. Open one course containing a current revision and confirm the displayed answer/analysis matches the revision while the original database payload remains unchanged.
10. Confirm a hidden duplicate returns no row through the authenticated `questions` API and that its removal changes the course catalog count/hash.
