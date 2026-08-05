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

assert(!/local-question-bank\.js|verified-question-overrides\.js/.test(html), "Production HTML still loads static question-bank scripts.");
assert(/shouldCreateUser:\s*false/.test(app), "OTP login must disable user self-registration.");
assert(/verifyOtp/.test(app) && /signInWithOtp/.test(app), "OTP request and verification flows are required.");
assert(/loadQuestionBankFromSupabase/.test(app), "Questions must be loaded from Supabase.");
assert(/from\("memberships"\)/.test(app), "Membership must be checked in the client UX.");
assert(/alter table public\.memberships enable row level security;/i.test(migration), "memberships RLS is missing.");
assert(/alter table public\.questions enable row level security;/i.test(migration), "questions RLS is missing.");
assert(/active members can read questions/i.test(migration), "Question RLS policy is missing.");
assert(/public\.is_active_member\(\)/.test(migration), "Question policy must require active membership.");
assert(/members can read own membership/i.test(migration), "Own-membership RLS policy is missing.");
assert(/revoke all on table public\.questions from anon, authenticated;/i.test(migration), "Question write access is not revoked.");
assert(/revoke all on table public\.memberships from anon, authenticated;/i.test(migration), "Membership write access is not revoked.");
console.log("Member access static contract passed.");
