const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const allFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else allFiles.push(file);
  }
}

if (!fs.existsSync(dist)) throw new Error("dist is missing. Run npm run build first.");
walk(dist);
const output = allFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const banned = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "service_role",
  "history-local-question-bank.js",
  "morality-local-question-bank.js",
  "mao-xi-local-question-bank.js",
  "marx-local-question-bank.js",
  "verified-question-overrides.js",
  "鸦片战争前中国封建社会的主要矛盾"
];
for (const value of banned) {
  if (output.includes(value)) throw new Error(`Production build contains forbidden content: ${value}`);
}
console.log(`Production build verified: ${allFiles.length} files, no static bank or service role secret.`);
