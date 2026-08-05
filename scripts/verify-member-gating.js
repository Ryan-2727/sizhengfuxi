const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const html = read("index.html");
const app = read("app.js");
const migration = read("supabase/migrations/202608040001_member_question_access.sql");
const catalogMigration = read("supabase/migrations/202608050003_question_bank_catalog.sql");

assert(!/local-question-bank\.js|verified-question-overrides\.js/.test(html), "Production HTML still loads static question-bank scripts.");
assert(/shouldCreateUser:\s*false/.test(app), "OTP login must disable user self-registration.");
assert(/verifyOtp/.test(app) && /signInWithOtp/.test(app), "OTP request and verification flows are required.");
assert(/ensureCourseQuestionBank/.test(app), "Questions must be loaded lazily from Supabase.");
assert(/question_bank_catalog/.test(app), "The client must load the question bank catalog first.");
assert(/pageSize = 100/.test(app), "Course question loading must use 100-row pages.");
assert(/sessionState\.memberValidated/.test(app), "Question cache access must require a validated membership.");
assert(/from\("memberships"\)/.test(app), "Membership must be checked in the client UX.");
assert(/alter table public\.memberships enable row level security;/i.test(migration), "memberships RLS is missing.");
assert(/alter table public\.questions enable row level security;/i.test(migration), "questions RLS is missing.");
assert(/active members can read questions/i.test(migration), "Question RLS policy is missing.");
assert(/public\.is_active_member\(\)/.test(migration), "Question policy must require active membership.");
assert(/members can read own membership/i.test(migration), "Own-membership RLS policy is missing.");
assert(/revoke all on table public\.questions from anon, authenticated;/i.test(migration), "Question write access is not revoked.");
assert(/revoke all on table public\.memberships from anon, authenticated;/i.test(migration), "Membership write access is not revoked.");
assert(/create table if not exists public\.question_bank_catalog/i.test(catalogMigration), "Question bank catalog migration is missing.");
assert(/alter table public\.question_bank_catalog enable row level security;/i.test(catalogMigration), "Catalog RLS is missing.");
assert(/active members can read question bank catalog/i.test(catalogMigration), "Catalog membership policy is missing.");
assert(/revoke all on table public\.question_bank_catalog from anon, authenticated;/i.test(catalogMigration), "Catalog writes are not revoked.");
console.log("Member access static contract passed.");
