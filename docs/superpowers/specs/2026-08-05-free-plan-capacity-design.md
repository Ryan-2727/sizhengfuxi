# Free Plan Capacity Design

## Goal

Keep the Supabase Free plan practical for a small paid member base without
weakening membership-gated question-bank access.

## Scope

- Load questions only when a member opens a course question workflow.
- Cache each authorized user's course data in IndexedDB by course revision.
- Limit active memberships to 300.
- Apply a client-side OTP resend cooldown while retaining Supabase rate limits.
- Move the repository to private visibility and disable GitHub Pages manually.

## Data Flow

1. Restore the Supabase session and read the caller's membership row.
2. Reject inactive, revoked, or expired users before reading IndexedDB.
3. Read the five-row question catalog under the same active-member RLS guard.
4. Use catalog counts for the home screen.
5. On a course question workflow, read a cache entry keyed by user id, course id,
   and the catalog content hash.
6. On a cache miss, page through only that course's question rows, then persist
   the result to IndexedDB.
7. On sign-out, delete that user's IndexedDB entries.

The browser cache is an acceleration layer only. It is never read until the
current session has passed membership verification, and Supabase RLS remains
the authority for every cache miss.

## Database

Add `question_bank_catalog` with one row per course:

- `course_id` primary key
- `choice_count` and `essay_count`
- `content_hash`
- `updated_at`

Only active members may select catalog rows. Only `service_role` may write
them. The importer computes a deterministic SHA-256 hash per course and only
changes a catalog row when that course's content changes.

## Membership Cap

`add-member` counts memberships with `status = 'active'` and a future expiry.
Creating a new membership is refused once the count reaches 300. Renewing an
existing member remains allowed. This is an operational guardrail, not an RLS
permission model.

## OTP Abuse Control

The login UI keeps a 60-second resend cooldown in browser state and disables
the send button during the cooldown. Supabase Authentication rate limits and
the custom SMTP provider remain the server-side enforcement layer.

## Repository Visibility

GitHub visibility and GitHub Pages are account settings, not repository code.
After deployment verification, manually set the repository private and disable
GitHub Pages. Cloudflare Pages continues to deploy from the private repository.

## Verification

- Valid members fetch only the catalog at startup.
- Course cache misses request only the selected course in pages of 100 rows.
- Same user/course/revision cache hits do not call `questions`.
- Changed hashes invalidate only the matching course cache.
- Invalid members cannot read the cache or call question queries.
- Sign-out deletes the current user's cache.
- The active-member cap refuses the 301st new active membership.
- OTP resend is disabled for 60 seconds after a request.
- Production build remains free of question-bank source files and service keys.
