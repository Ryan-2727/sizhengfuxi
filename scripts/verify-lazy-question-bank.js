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
  const loader = await import(pathToFileURL(path.join(root, "src/concurrent-batches.js")).href);
  const one = { userId: "user-one", courseId: "history", contentHash: "a".repeat(64), choices: [{ question: "one" }], essays: [] };
  const two = { userId: "user-two", courseId: "history", contentHash: "a".repeat(64), choices: [{ question: "two" }], essays: [] };

  await cache.putCourseQuestionCache(one);
  await cache.putCourseQuestionCache(two);
  assert.equal((await cache.getCourseQuestionCache(one)).choices[0].question, "one", "matching account and version must hit cache");
  assert.equal(await cache.getCourseQuestionCache({ ...one, contentHash: "b".repeat(64) }), null, "a changed content hash must miss cache");
  await cache.deleteCourseQuestionCache(one);
  assert.equal(await cache.getCourseQuestionCache(one), null, "stale in-flight downloads must be removable by account, course and version");
  await cache.putCourseQuestionCache(one);
  await cache.deleteUserQuestionCaches(one.userId);
  assert.equal(await cache.getCourseQuestionCache(one), null, "logout must delete only the current account cache");
  assert.equal((await cache.getCourseQuestionCache(two)).choices[0].question, "two", "one account must not delete another account cache");

  let activeRequests = 0;
  let peakRequests = 0;
  const progress = [];
  const batchResults = await loader.runConcurrentBatches([0, 1, 2, 3, 4, 5, 6], async (value) => {
    activeRequests += 1;
    peakRequests = Math.max(peakRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeRequests -= 1;
    return [value];
  }, {
    concurrency: 3,
    onBatch: ({ completedBatches }) => progress.push(completedBatches)
  });
  assert.deepEqual(batchResults.flat(), [0, 1, 2, 3, 4, 5, 6], "parallel pages must retain their original order");
  assert.equal(peakRequests, 3, "question loading must cap parallel page requests at three");
  assert.deepEqual(progress, [1, 2, 3, 4, 5, 6, 7], "loading progress must advance once per completed page");

  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const ensureStart = app.indexOf("async function ensureCourseQuestionBank");
  const ensureEnd = app.indexOf("function jumpToCourseTop", ensureStart);
  const ensure = app.slice(ensureStart, ensureEnd);
  assert(ensure.includes("sessionState.memberValidated"), "cache reads must follow membership validation");
  assert(ensure.indexOf("sessionState.memberValidated") < ensure.indexOf("getCourseQuestionCache"), "membership validation must precede cache reads");
  assert(ensure.includes("const pageSize = 100"), "question downloads must use 100-row pages");
  assert(ensure.includes("const pageConcurrency = 3"), "question downloads must use the reviewed three-page concurrency cap");
  assert(ensure.includes("runConcurrentBatches"), "question and quality pages must use the bounded concurrent loader");
  assert(ensure.includes('.eq("course_id", course.id)'), "question downloads must be course scoped");
  assert(ensure.includes("putCourseQuestionCache"), "first course downloads must be cached");
  assert(ensure.includes("loadQuestionQuality(rows, { assertSession, report })"), "published questions must load quality metadata before caching");
  assert(app.includes('from("question_quality")'), "question quality metadata must come from Supabase");
  assert(app.includes('from("question_revisions")'), "current editorial revisions must come from Supabase");
  assert(app.includes('const curationColumns = "curation_status, curation_rank, curation_reason, curation_version"'), "course loading must fetch curation metadata");
  assert(ensure.includes("merged.curationStatus = quality?.curation_status"), "curation metadata must be merged before IndexedDB caching");
  assert(ensure.includes('result.error?.code === "42703"'), "the frontend must remain usable while the curation migration is pending");
  assert(app.includes('filterButton("curated", "章节精选")'), "the question bank needs a chapter-curated filter");
  assert(app.includes('hasCuratedQuestions ? filterButton("curated", "章节精选") : ""'), "the curation filter must stay hidden until the course has curated questions");
  assert(ensure.indexOf("loadQuestionQuality(rows, { assertSession, report })") < ensure.indexOf("putCourseQuestionCache"), "quality overlays must be applied before IndexedDB caching");
  assert(app.includes("courseLoadTasks.get(courseId)"), "simultaneous entry points must reuse one course load task");
  assert(app.includes("questionBankSessionVersion === sessionVersion"), "logout or account changes must stop stale downloads before caching");
  assert(ensure.includes("deleteCourseQuestionCache(cacheKey)"), "a stale write finishing after logout must remove its exact cache record");
  assert(app.includes("首次打开该课程需要下载题库"), "the question panel must explain first-load behavior");
  assert(app.includes("已完成 ${completed} / ${total} 题"), "the question panel must show numeric loading progress");
  assert(app.includes('from("question_bank_catalog")'), "startup must load the catalog");
  assert(!app.includes("loadQuestionBankFromSupabase"), "startup must not use the old full-bank loader");
  assert(/function cleanAnalysisText\(/.test(app), "choice analysis rendering must include its text-cleaning helper");
  console.log("Lazy course cache contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
