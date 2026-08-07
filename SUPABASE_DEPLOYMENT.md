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
```

The migrations create `memberships`, `questions`, and `question_bank_catalog`, enable RLS on every business table, grant no browser write permissions, and permit catalog and question reads only through `public.is_active_member()`.

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

The importer refuses to overwrite an existing question table. To intentionally replace it after reviewing the source data:

```powershell
npm run import:questions -- --replace
```

To add only the repository's curated supplement without changing or deleting existing question rows, use:

```powershell
npm run import:questions -- --append-curated
```

This mode checks question stems for duplicates, appends only missing curated questions at the end of each course and question type, then recalculates catalog counts and hashes from the database.

When a reviewed correction affects only the curated supplement, sync it without touching the original question-bank rows:

```powershell
npm run import:questions -- --sync-curated
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

Set only these build-time environment variables in Cloudflare Pages:

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

Do not configure `SUPABASE_SERVICE_ROLE_KEY` in Cloudflare Pages. Vite inserts only the two browser-safe variables above into the built client.

## 6. Required acceptance checks after deployment

1. An unsigned browser only sees the email OTP screen.
2. An unknown email is rejected because the client sends `shouldCreateUser: false`.
3. A member email receives an OTP and can enter the site.
4. An active, unexpired member sees the five course counts from `question_bank_catalog`; opening a course loads only that course's questions in 100-row pages.
5. A missing, revoked, or expired `memberships` record cannot load any rows.
6. In the Supabase API docs or SQL editor, test an anon `select` against `public.questions`; it must return no rows because of RLS.
7. Run `npm run build` and `node scripts/verify-production-build.js` before every production deployment.
8. Run `npm run verify:lazy-cache`; it verifies account isolation, version invalidation, logout cache deletion, and the lazy-loading contract.
