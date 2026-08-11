const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/migrations/202608110009_user_feedback.sql");
const submitApi = read("functions/api/feedback/index.js");
const adminListApi = read("functions/api/admin/feedback/index.js");
const adminUpdateApi = read("functions/api/admin/feedback/[feedbackNo].js");
const app = read("app.js");
const html = read("index.html");

assert(/create table if not exists public\.feedback/i.test(migration), "feedback table migration is missing.");
assert(/alter table public\.feedback enable row level security/i.test(migration), "feedback RLS is missing.");
assert(/revoke all on table public\.feedback from public, anon, authenticated/i.test(migration), "browser roles must not access feedback directly.");
assert(/grant all on table public\.feedback to service_role/i.test(migration), "server must be able to store feedback.");
assert(/requestUser\(request, env\)/.test(submitApi), "feedback should associate an existing session when available.");
assert(/serviceClient\(env\)/.test(submitApi) && /from\("feedback"\)\.insert/.test(submitApi), "feedback must be stored by the server.");
assert(/notifyAdministrator/.test(submitApi) && /RESEND_API_KEY/.test(submitApi), "optional email notification is missing.");
assert(/Feedback was saved but email notification failed/.test(submitApi), "email failure must not discard saved feedback.");
assert(/requireAdmin\(request, env\)/.test(adminListApi), "feedback inbox must verify the administrator.");
assert(/requireAdmin\(request, env\)/.test(adminUpdateApi), "feedback updates must verify the administrator.");
assert(/FEEDBACK_STATUSES\.has\(status\)/.test(adminUpdateApi), "feedback updates must whitelist statuses.");
assert(/apiRequest\("\/api\/feedback"/.test(app), "browser feedback form must use the server endpoint.");
assert(!/issues\/new/.test(app), "primary feedback submission must not redirect to GitHub.");
assert(/\/admin\/feedback/.test(app) && /id="adminFeedbackView"/.test(html), "admin feedback inbox is missing.");
assert(/id="feedbackWebsite"/.test(html), "feedback honeypot is missing.");
console.log("Feedback flow static contract passed.");
