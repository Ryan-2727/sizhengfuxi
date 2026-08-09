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
```

The migrations create `memberships`, `questions`, `question_bank_catalog`, `question_quality`, `question_revisions`, and `question_quality_events`, enable RLS on every business table, grant no browser write permissions, and permit catalog and published-question reads only through `public.is_active_member()`.

The fourth migration adds chapter metadata to `questions`. It does not alter question stems, answers, analyses, order, or RLS. `verified` is reserved for editorially checked assignments; `candidate` is a visible, non-final rule result.

The fifth migration seeds one quality row per existing question, makes `questions.payload` immutable, and changes question RLS so active members can read only `publication_status = 'published'` rows. Current display corrections live in `question_revisions`; normal authenticated users cannot write quality, revisions, or audit events.

Run the fifth migration before deploying the matching frontend. The new frontend requires `question_quality` and reads current revisions before writing a course to IndexedDB.

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

This mode checks question stems for duplicates, appends only missing curated questions at the end of each course and question type, then recalculates catalog counts and hashes from the database.

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
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are build-time browser-safe values. `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_EMAILS` are read only by Cloudflare Pages Functions at runtime. Do not use a `VITE_` prefix for either server-only value, do not put them in `.env` committed to Git, and do not expose them in browser code. Vite inserts only the two browser-safe values above into the built client.

## 7. Manual payment membership

After running `supabase/migrations/202608090006_purchase_orders.sql`, the public paths are `/buy`, `/pay/:orderNo`, and `/order/:orderNo`. Existing `assets/alipay.jpg` and `assets/wechat.jpg` are deployed as:

```text
public/payment/alipay-qr.jpg
public/payment/wechat-qr.jpg
```

Replace only those two files if the real collection codes change. Do not generate placeholder QR codes.

Set `ADMIN_EMAILS` to the comma-separated email address(es) that can use `/admin/orders`. Each administrator must first log in through the existing email OTP flow. The browser sends only that existing session token; Cloudflare verifies the token and compares its email with `ADMIN_EMAILS` server-side.

Payment flow: a buyer creates one `pending_payment` order for `¥9.90 / 30 days`, submits a payment method and the last six payment-order characters, then the order becomes `pending_review`. An administrator checks the actual payment and selects **确认付款并开通**. Only then does the protected server function create or reuse the Supabase Auth user for that order email. The SQL function locks the order, adds 30 days to a current active expiry or starts from database `now()` when new/expired, then marks the order approved. Repeating approval for the same order returns `already_processed` and does not add time again.

Run this verification before deployment:

```powershell
npm run verify:payments
```

## 6. Required acceptance checks after deployment

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
