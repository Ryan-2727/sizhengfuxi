const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const root = path.resolve(__dirname, "..");
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const outputIndex = process.argv.indexOf("--output");
const requestedOutput = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";
if (outputIndex >= 0 && !requestedOutput) throw new Error("--output requires a directory path.");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDirectory = path.resolve(root, requestedOutput || path.join("backups", timestamp));
const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const tables = [
  ["memberships", "user_id"],
  ["orders", "id"],
  ["feedback", "id"],
  ["questions", "id"],
  ["question_bank_catalog", "course_id"],
  ["question_quality", "question_id"],
  ["question_revisions", "id"],
  ["question_quality_events", "id"]
];

async function readTable(table, orderColumn) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await service
      .from(table)
      .select("*")
      .order(orderColumn, { ascending: true })
      .range(from, from + 499);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

function writeJson(fileName, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(path.join(outputDirectory, fileName), body, { encoding: "utf8", flag: "wx" });
  return {
    file: fileName,
    sha256: crypto.createHash("sha256").update(body).digest("hex")
  };
}

async function readAuthUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 500 });
    if (error) throw error;
    users.push(...data.users.map((user) => ({
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at
    })));
    if (data.users.length < 500) return users;
  }
}

async function main() {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const manifest = {
    createdAt: new Date().toISOString(),
    projectUrl: supabaseUrl,
    files: []
  };
  for (const [table, orderColumn] of tables) {
    const rows = await readTable(table, orderColumn);
    manifest.files.push({ ...writeJson(`${table}.json`, rows), rows: rows.length });
    console.log(`${table}: ${rows.length}`);
  }
  const authUsers = await readAuthUsers();
  manifest.files.push({ ...writeJson("auth-users.json", authUsers), rows: authUsers.length });
  writeJson("manifest.json", manifest);
  console.log(`Backup completed: ${outputDirectory}`);
  console.log("Keep this directory private; it contains account and business data.");
}

main().catch((error) => {
  console.error(`Backup failed: ${error.message || error}`);
  process.exitCode = 1;
});
