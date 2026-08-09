const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { indexedDB, IDBKeyRange } = require("fake-indexeddb");

global.indexedDB = indexedDB;
global.IDBKeyRange = IDBKeyRange;

async function main() {
  const root = path.resolve(__dirname, "..");
  const cache = await import(pathToFileURL(path.join(root, "src/question-bank-cache.js")).href);
  const one = { userId: "user-one", courseId: "history", contentHash: "a".repeat(64), choices: [{ question: "one" }], essays: [] };
  const two = { userId: "user-two", courseId: "history", contentHash: "a".repeat(64), choices: [{ question: "two" }], essays: [] };

  await cache.putCourseQuestionCache(one);
  await cache.putCourseQuestionCache(two);
  assert.equal((await cache.getCourseQuestionCache(one)).choices[0].question, "one", "matching account and version must hit cache");
  assert.equal(await cache.getCourseQuestionCache({ ...one, contentHash: "b".repeat(64) }), null, "a changed content hash must miss cache");
  await cache.deleteUserQuestionCaches(one.userId);
  assert.equal(await cache.getCourseQuestionCache(one), null, "logout must delete only the current account cache");
  assert.equal((await cache.getCourseQuestionCache(two)).choices[0].question, "two", "one account must not delete another account cache");

  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const ensureStart = app.indexOf("async function ensureCourseQuestionBank");
  const ensureEnd = app.indexOf("function jumpToCourseTop", ensureStart);
  const ensure = app.slice(ensureStart, ensureEnd);
  assert(ensure.includes("sessionState.memberValidated"), "cache reads must follow membership validation");
  assert(ensure.indexOf("sessionState.memberValidated") < ensure.indexOf("getCourseQuestionCache"), "membership validation must precede cache reads");
  assert(ensure.includes("const pageSize = 100"), "question downloads must use 100-row pages");
  assert(ensure.includes('.eq("course_id", courseId)'), "question downloads must be course scoped");
  assert(ensure.includes("putCourseQuestionCache"), "first course downloads must be cached");
  assert(ensure.includes("loadQuestionQuality(rows)"), "published questions must load quality metadata before caching");
  assert(app.includes('from("question_quality")'), "question quality metadata must come from Supabase");
  assert(app.includes('from("question_revisions")'), "current editorial revisions must come from Supabase");
  assert(ensure.indexOf("loadQuestionQuality(rows)") < ensure.indexOf("putCourseQuestionCache"), "quality overlays must be applied before IndexedDB caching");
  assert(app.includes('from("question_bank_catalog")'), "startup must load the catalog");
  assert(!app.includes("loadQuestionBankFromSupabase"), "startup must not use the old full-bank loader");
  assert(/function cleanAnalysisText\(/.test(app), "choice analysis rendering must include its text-cleaning helper");
  console.log("Lazy course cache contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
