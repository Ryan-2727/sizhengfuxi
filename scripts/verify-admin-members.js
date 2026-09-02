const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const api = read("functions/api/admin/members/index.js");
const app = read("app.js");
const html = read("index.html");

assert(/requireAdmin\(request, env\)/.test(api), "member list API must verify the administrator.");
assert(/serviceClient\(env\)/.test(api), "member list API must query through the server client.");
assert(/select\("email, status, expires_at, created_at, updated_at"/.test(api), "member list API should expose only required membership fields.");
assert(/\/api\/admin\/members/.test(app), "member list UI must use the protected API.");
assert(/path === "\/admin\/members"/.test(app), "admin member route is missing.");
assert(/id="adminMembersView"/.test(html), "admin member view is missing.");
assert((html.match(/href="\/admin\/members"/g) || []).length >= 3, "all admin pages must link to the member list.");
assert(!/SUPABASE_SERVICE_ROLE_KEY/.test(app) && !/SUPABASE_SERVICE_ROLE_KEY/.test(html), "service role key must not appear in browser sources.");

async function verifyAnonymousAccessIsDenied() {
  const moduleUrl = pathToFileURL(path.join(root, "functions/api/admin/members/index.js")).href;
  const { onRequestGet } = await import(moduleUrl);
  const response = await onRequestGet({ request: new Request("https://example.test/api/admin/members"), env: {} });
  assert(response.status === 403, "anonymous member list requests must be rejected.");
}

verifyAnonymousAccessIsDenied()
  .then(() => console.log("Admin member list contract passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
