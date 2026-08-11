# Production Hardening and Content Operations Design

## Scope

This change completes seven targeted improvements without replacing the existing Vite frontend, Supabase membership model, OTP login, immutable question payloads, or Cloudflare Pages deployment.

1. Protect public feedback and order creation with Cloudflare Turnstile and server-side request limits.
2. Add a public membership, privacy, refund, and content-scope page.
3. Show protected pending-order and feedback counts in the existing administrator views.
4. Provide a single content-quality command over the existing question audit tools.
5. Display course edition, site-content update date, and honest verification state.
6. Extend feedback resolution into a correction workflow without directly editing original question payloads.
7. Add a local, service-role-only Supabase backup command.

## Public Request Protection

The browser renders Turnstile only on the feedback form and order-creation form. It sends the returned token with the existing request body. Pages Functions verify the token with Cloudflare before performing database work. Missing or invalid tokens fail closed in production; local development may use Cloudflare's documented test keys.

A migration adds a private request-limit table and an atomic service-role RPC. Pages Functions derive a one-way request fingerprint from the client address and the server-only service key. Raw IP addresses are never stored. Limits are intentionally generous for campus NAT traffic and apply independently to feedback and order creation. Existing feedback honeypot, client cooldown, and unfinished-order reuse remain in place.

## Public Information Page

The existing client router gains `/terms`. The page explains the fixed price and 30-day period, manual payment review, renewal behavior, content limitations, refund/contact process, personal-data use, local study data, and that the site is not an official school service. Links are added to the buy/pay views and footer. The page uses the current design system and contains no unsupported promises.

## Administrator Summary

A protected `/api/admin/summary` Pages Function verifies the existing OTP session and `ADMIN_EMAILS`, then returns only aggregate counts for pending-review orders and new/reviewing feedback. Existing admin pages display these counts as compact badges and refresh them with their current list reload behavior. Anonymous and non-admin requests remain forbidden.

## Content Quality and Versioning

`npm run content:qa` runs the existing immutable-payload, editorial-quality, coverage, analysis, navigation, and knowledge checks in a fixed order. It produces a concise local report from existing audit data and does not rewrite questions.

Course data gains a site-content update date and a verification summary derived from existing source metadata. The UI distinguishes textbook edition, content update date, verified material, and material still requiring manual review. It never labels the full bank as verified when review queues remain.

## Correction Workflow

Feedback records gain a resolution kind: `fixed`, `no_change`, or `needs_review`, plus optional links to a question revision and the catalog hash observed when the issue was resolved. Administrator actions require a note for content-related outcomes.

Question reports retain course and question identifiers. Marking a report `needs_review` records an audit event and places the question in the existing manual quality workflow. Marking it `fixed` records the revision/hash evidence but does not modify `questions.payload`. Actual corrections continue through `question_revisions` and the existing quality-sync scripts; catalog recalculation changes only the affected course hash, causing its IndexedDB cache to expire.

## Backups

`npm run backup:supabase` requires local `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. It exports business tables in stable, paginated JSON files, then writes a manifest containing row counts and SHA-256 checksums. The timestamped backup directory is Git-ignored. The script never prints keys and performs no writes to Supabase.

The deployment guide documents a weekly backup routine, restoration caveats, and the rule that backup archives contain private data and must not be committed or shared publicly.

## Error Handling

- Turnstile unavailable or invalid: show a retryable verification message and perform no database write.
- Rate limit exceeded: return HTTP 429 with a short retry message.
- Administrator summary failure: keep the admin lists usable and show a non-blocking count error.
- Backup failure: stop with a non-zero exit code and do not claim a complete manifest.
- Content QA failure: preserve the generated report and return a non-zero exit code.

## Security

- `TURNSTILE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` remain server-only.
- RLS and revoked browser grants remain enabled for orders, feedback, memberships, quality tables, and request limits.
- Browser users cannot approve orders, alter membership expiry, edit original question payloads, or read private feedback.
- Backups, `.env`, `.dev.vars`, and generated audit source data remain outside Git.

## Verification

Static and integration checks must verify:

- Turnstile is required by both public write endpoints and verified server-side.
- Request limits are atomic, private, and return 429 when exhausted.
- `/terms` is public and linked from purchase surfaces.
- Administrator summary requires `ADMIN_EMAILS` authorization.
- Feedback resolution kinds are constrained and cannot mutate original question payloads.
- Course version fields exist for all five courses.
- The aggregate content-quality command runs the existing checks.
- Backup output is ignored by Git and includes row counts and hashes.
- Existing feedback, payments, membership, lazy cache, study tools, build, and production security scans still pass.

## Manual Deployment Steps

1. Create a Cloudflare Turnstile widget for the production hostname.
2. Add `TURNSTILE_SITE_KEY` as Text and `TURNSTILE_SECRET_KEY` as Secret in Cloudflare Production.
3. Run the new Supabase migration after all existing migrations.
4. Deploy the matching frontend and Pages Functions together.
5. Run a live feedback submission and a test order creation before accepting production traffic.
