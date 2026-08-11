const assert = require("assert");
const fs = require("fs");
const path = require("path");

const migration = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "202608090005_question_editorial_quality.sql"), "utf8");
const digestFixMigration = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "202608110008_fix_question_quality_digest.sql"), "utf8");

for (const table of ["question_quality", "question_revisions", "question_quality_events"]) {
  assert(new RegExp(`create table if not exists public\\.${table}`).test(migration), `${table} table is missing`);
  assert(new RegExp(`alter table public\\.${table} enable row level security`).test(migration), `${table} RLS is missing`);
}
assert(/questions\.payload is immutable/.test(migration), "Payload immutability trigger is missing");
assert(/is_question_published\(id\)/.test(migration), "Published-question RLS enforcement is missing");
assert(/publication_status = 'published'/.test(migration), "Published status is not enforced");
assert(/revoke all on table public\.question_quality from anon, authenticated/.test(migration), "Question quality write grants are unsafe");
assert(/grant all on table public\.question_quality to service_role/.test(migration), "Service role quality access is missing");
assert(/original_payload_hash/.test(migration), "Original payload hash is missing");
assert(/correct_answer_override text/.test(migration), "Choice-answer revision override is missing");
assert(/extensions\.digest\(convert_to\(new\.payload::text, 'UTF8'\), 'sha256'::text\)/.test(digestFixMigration), "Question insert hashing must resolve pgcrypto from the extensions schema");
assert(/set search_path = public, extensions/.test(digestFixMigration), "Question insert trigger must include the extensions schema");

console.log("Editorial quality migration static contract passed.");
