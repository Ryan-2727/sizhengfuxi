const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildEditorialManifest } = require("./lib/editorial-manifest");
const { loadQuestionBank } = require("./lib/load-question-bank");
const {
  CURATION_TARGETS,
  CURATION_VERSION,
  questionEligibility,
  tooSimilar
} = require("./lib/question-curation");
const { payloadHash, stableJson } = require("./lib/editorial-quality");

async function main() {
  const first = await buildEditorialManifest();
  const second = await buildEditorialManifest();
  const api = loadQuestionBank();
  const byRef = new Map(first.entries.map((entry) => [entry.ref, entry]));

  assert.equal(first.curation.version, CURATION_VERSION, "Curation version drifted.");
  assert.deepEqual(first.curation.targets, CURATION_TARGETS, "Curation targets drifted.");
  assert.equal(stableJson(first.curation), stableJson(second.curation), "Curation selection must be deterministic.");
  assert.equal(new Set(first.curation.entries.map((entry) => entry.ref)).size, first.curation.entries.length, "Curated question references must be unique.");
  assert.equal(first.curationReport.totals.chapters, 55, "Curation coverage must include all 55 textbook chapters.");
  assert(first.curationReport.chapters.every((chapter) => chapter.courseTitle && chapter.chapterTitle), "Every curation coverage row needs a course and chapter title.");

  const grouped = new Map();
  for (const curated of first.curation.entries) {
    const entry = byRef.get(curated.ref);
    assert(entry, `${curated.ref} is missing from the editorial manifest.`);
    assert.equal(payloadHash(entry.payload), entry.originalPayloadHash, `${entry.ref} original payload changed.`);
    assert(questionEligibility(entry, api).eligible, `${entry.ref} no longer satisfies the curation quality gate.`);
    assert.equal(entry.quality.publicationStatus, "published", `${entry.ref} is not published.`);
    assert.equal(entry.chapter.status, "verified", `${entry.ref} chapter is not verified.`);
    assert.equal(entry.quality.reviewStatus, "source_verified", `${entry.ref} source is not verified.`);
    assert.equal(entry.quality.curationStatus, "chapter_core", `${entry.ref} curation status mismatch.`);
    assert.equal(entry.quality.curationRank, curated.rank, `${entry.ref} curation rank mismatch.`);
    assert(entry.quality.curationReason, `${entry.ref} lacks a curation reason.`);
    const key = `${entry.courseId}:${entry.chapter.chapterId}:${entry.questionType}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }

  for (const [key, entries] of grouped) {
    const type = key.endsWith(":choice") ? "choice" : "essay";
    assert(entries.length <= CURATION_TARGETS[type], `${key} exceeds its curation target.`);
    assert.deepEqual(entries.map((entry) => entry.quality.curationRank).sort((a, b) => a - b), Array.from({ length: entries.length }, (_, index) => index + 1), `${key} ranks are not contiguous.`);
    for (let left = 0; left < entries.length; left += 1) {
      for (let right = left + 1; right < entries.length; right += 1) {
        assert(!tooSimilar(entries[left], entries[right]), `${entries[left].ref} and ${entries[right].ref} are too similar for one curated set.`);
      }
    }
  }

  const committed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "question-curation-manifest.json"), "utf8"));
  assert.equal(stableJson(committed), stableJson(first.curation), "Committed curation manifest is stale; run npm run questions:audit-curation.");
  assert(!JSON.stringify(committed).includes("question\""), "Lightweight curation manifest must not contain question text.");
  assert.equal(first.entries.filter((entry) => entry.issues.includes("high-risk-statement-needs-source-review") && entry.quality.publicationStatus === "published").length, 0, "A high-risk question without strong evidence remains published.");
  assert.equal(first.entries.filter((entry) => entry.issues.includes("answer-leaked-in-stem") && entry.quality.publicationStatus === "published").length, 0, "A choice question leaking its answer remains published.");

  const conflictingChapter = byRef.get("history:choice:2");
  assert.equal(conflictingChapter.chapter.status, "candidate", "Conflicting textbook and stem chapter evidence must not be marked verified.");
  assert(conflictingChapter.issues.includes("chapter-evidence-conflict"), "Conflicting chapter evidence must remain visible to reviewers.");
  assert.equal(conflictingChapter.quality.curationStatus, "standard", "A chapter-conflict question must not enter the curated set.");

  const recoveredEssay = byRef.get("xi:essay:16");
  assert(recoveredEssay.issues.includes("answer-recovered-from-question"), "The recovered-answer regression sample changed unexpectedly.");
  assert.equal(recoveredEssay.quality.curationStatus, "standard", "A recovered-answer essay must not enter the curated set.");

  console.table([first.curationReport.totals]);
  console.log("Chapter curation quality contract passed without mutating original payloads.");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
