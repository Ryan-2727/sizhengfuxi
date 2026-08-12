const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "sync-question-quality.js"), "utf8");
assert(/process\.argv\.includes\("--apply"\)/.test(source), "Quality synchronization must be opt-in.");
assert(/payloadHash\(state\.question\.payload\)/.test(source), "Quality synchronization must verify immutable payload hashes.");
assert(!/\.from\("questions"\)[\s\S]{0,200}\.update\(\{\s*payload/.test(source), "Quality synchronization must not update questions.payload.");
assert(/chapter_assignment_status/.test(source), "Chapter candidates must be synchronized as metadata.");
assert(/managedReference/.test(source), "Automatically verified textbook-page assignments must be downgradeable when independent chapter checks conflict.");
assert(/entry\.chapter\.status === "candidate" && !allowManagedDowngrade/.test(source), "Managed verified assignments must not be blocked by the candidate write guard.");
assert(/updateQuestionBankCatalog/.test(source), "Quality synchronization must refresh catalog hashes.");
assert(/SUPABASE_SERVICE_ROLE_KEY/.test(source), "Quality synchronization must require the service-role environment variable.");
for (const field of ["curation_status", "curation_rank", "curation_reason", "curation_version", "curated_at"]) {
  assert(source.includes(field), `${field} must be synchronized through the service-role workflow.`);
}
console.log("Question quality synchronization static contract passed.");
