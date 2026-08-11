# Member experience upgrade design

## Scope

Improve the existing manual-payment membership flow and study continuity without changing OTP login, membership authorization, question RLS, payment amount, or the manual review model.

## A. Order reliability

- Persist each high-entropy order access token in localStorage with a 60-day retention window so closing a tab does not strand an anonymous buyer.
- Show a recent unfinished-order continuation entry and a private order-link copy control.
- Poll a pending-review order every 20 seconds while its status page is visible; stop polling when leaving the view.
- Store the resulting membership expiry on the approved order through a new migration and show it to the buyer and administrator.
- Require an explicit confirmation containing the stored order email, amount, payment method, and reference before an administrator sends approval.
- Keep server-side locking, state checks, and idempotency as the actual duplicate-approval protection.

## B. Payment usability

- Explain where to locate the transaction identifier in Alipay and WeChat, while noting app wording can vary by version.
- Let the QR image open at a larger size and remain directly saveable on mobile.
- Preserve selected method and payment reference across method switches and failed submissions.
- Add one-click copy controls for order number and private query link, with visible success/failure feedback.
- Keep rejected orders on the original order and emphasize the administrator's review note.

## C. Membership and study continuity

- Show the active membership expiry in the member header and expose renewal only when it is useful.
- Save the latest course and chapter in the existing study-progress localStorage record.
- Add a member-home continuation entry and local wrong-question/mastery summary without loading additional question banks.
- Keep free-preview attempts in the same existing progress store so matching question IDs remain available after login.
- Add concise purchase, privacy, and manual-review notices; do not add marketing claims or a new account system.

## Security and verification

- Order tokens never enter URLs copied for general sharing; the private copy action warns the buyer not to forward the link.
- Direct browser access to orders and memberships remains denied by Supabase RLS and grants.
- No service-role key or administrator allowlist enters Vite source or `dist`.
- Verify existing member gating, campus preview, lazy course cache, payment state machine, production build, and static secret scan.
