const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/migrations/202608110010_production_hardening.sql");
const requestHelper = read("functions/_shared/public-request.js");
const orderApi = read("functions/api/orders/index.js");
const feedbackApi = read("functions/api/feedback/index.js");
const adminSummaryApi = read("functions/api/admin/summary.js");
const feedbackAdminApi = read("functions/api/admin/feedback/[feedbackNo].js");
const app = read("app.js");
const html = read("index.html");
const courseContent = read("src/course-content.js");
const envExample = read(".env.example");
const gitignore = read(".gitignore");

assert(/create table if not exists public\.request_rate_limits/i.test(migration), "rate-limit table is missing.");
assert(/alter table public\.request_rate_limits enable row level security/i.test(migration), "rate-limit RLS is missing.");
assert(/revoke all on table public\.request_rate_limits from public, anon, authenticated/i.test(migration), "browser roles must not access rate limits.");
assert(/security definer/i.test(migration) && /consume_request_limit/i.test(migration), "atomic rate-limit RPC is missing.");
assert(/verifyTurnstile/.test(orderApi) && /action: "create_order"/.test(orderApi), "order creation must require Turnstile.");
assert(/consumeRequestLimit/.test(orderApi) && /limit: 5/.test(orderApi), "order creation limit is missing.");
assert(/verifyTurnstile/.test(feedbackApi) && /action: "feedback"/.test(feedbackApi), "feedback must require Turnstile.");
assert(/consumeRequestLimit/.test(feedbackApi) && /limit: 20/.test(feedbackApi), "feedback limit is missing.");
assert(/CF-Connecting-IP/.test(requestHelper) && /sha256Hex/.test(requestHelper), "rate limits must hash the request fingerprint.");
assert(/requireAdmin\(request, env\)/.test(adminSummaryApi), "admin summary must verify administrator access.");
assert(/pending_review/.test(adminSummaryApi) && /reviewing/.test(adminSummaryApi), "admin counters are incomplete.");
assert(/resolution_kind/.test(migration) && /resolved_revision_id/.test(migration) && /resolved_catalog_hash/.test(migration), "feedback correction evidence fields are missing.");
assert(/feedback_question_database_id_fkey/.test(migration) && /feedback_resolved_revision_id_fkey/.test(migration), "feedback correction evidence needs foreign keys.");
assert(/question_quality/.test(feedbackAdminApi) && /current_revision_id/.test(feedbackAdminApi), "fixed feedback must require a published revision.");
assert(/reportedRevisionId/.test(feedbackAdminApi) && /用户报错时相同/.test(feedbackAdminApi), "fixed feedback must require a newer revision when the report identifies one.");
assert(/question_bank_catalog/.test(feedbackAdminApi) && /content_hash/.test(feedbackAdminApi), "fixed feedback must record the course catalog version.");
assert(/id="termsView"/.test(html) && /\/terms/.test(app), "public terms page is missing.");
assert(/contentUpdatedAt/.test(courseContent) && /contentVerification/.test(courseContent), "course content version metadata is missing.");
assert(/TURNSTILE_SITE_KEY/.test(envExample) && /TURNSTILE_SECRET_KEY/.test(envExample), "Turnstile environment examples are missing.");
assert(/^backups\/$/m.test(gitignore), "private backup directory must be ignored by Git.");
assert(!/SUPABASE_SERVICE_ROLE_KEY\s*=\s*(?!your-service-role-key)/.test(envExample), "real service key must not be present in .env.example.");

console.log("Production hardening static contract passed.");
