const assert = require("assert");
const {
  MANUAL_ANSWER_CORRECTIONS,
  MANUAL_CHOICE_CORRECTIONS,
  MANUAL_ESSAY_ANSWER_COMBINATIONS,
  MANUAL_HIDDEN_DUPLICATE_CANONICALS,
  MANUAL_HIDDEN_REVIEW_REASONS,
  buildEditorialManifest
} = require("./lib/editorial-manifest");
const { normalizeText, payloadHash } = require("./lib/editorial-quality");

async function main() {
  const manifest = await buildEditorialManifest();
  assert.equal(manifest.entries.length, 3332, "Editorial manifest must cover every original question.");
  assert.equal(new Set(manifest.entries.map((entry) => entry.ref)).size, manifest.entries.length, "Question references must be unique.");
  assert.equal(manifest.report.totals.essays, 203, "All 203 essays must be audited.");

  for (const entry of manifest.entries) {
    assert.equal(payloadHash(entry.payload), entry.originalPayloadHash, `${entry.ref} payload hash changed during audit.`);
    assert(entry.quality.sourceKind && entry.quality.reviewStatus && entry.quality.verificationStatus, `${entry.ref} lacks structured quality metadata.`);
    assert(["published", "hidden_duplicate", "hidden_review"].includes(entry.quality.publicationStatus), `${entry.ref} has an invalid publication status.`);
    if (entry.quality.publicationStatus === "hidden_duplicate") assert(entry.quality.canonicalRef, `${entry.ref} duplicate lacks a canonical reference.`);
    if (entry.quality.publicationStatus === "hidden_review") {
      const reason = MANUAL_HIDDEN_REVIEW_REASONS.get(entry.ref);
      assert(reason, `${entry.ref} is hidden for review without a reviewed reason.`);
      assert(entry.issues.includes(reason), `${entry.ref} lacks its reviewed hidden-state issue.`);
      assert.equal(entry.quality.reviewStatus, "needs_manual_review", `${entry.ref} hidden review must remain in the manual queue.`);
      assert.equal(entry.quality.canonicalRef, null, `${entry.ref} hidden review must not be treated as a duplicate.`);
    }
    if (entry.questionType === "choice") {
      assert(!entry.issues.includes("invalid-choice-answer"), `${entry.ref} has an invalid choice answer.`);
      assert(!entry.issues.includes("choice-type-mismatch"), `${entry.ref} has an invalid choice type.`);
      const analysis = entry.revision.displayAnalysis || entry.payload.analysis;
      assert((analysis.match(/[^。！？!?\n]+[。！？!?]?/g) || []).length >= 2, `${entry.ref} choice analysis remains too short.`);
      const manualChoiceCorrection = MANUAL_CHOICE_CORRECTIONS.get(entry.ref);
      if (manualChoiceCorrection) {
        assert.equal(entry.revision.correctAnswerOverride, manualChoiceCorrection.answer, `${entry.ref} lacks its reviewed answer override.`);
        assert.equal(entry.revision.displayAnswer, `正确答案：${manualChoiceCorrection.answer}`, `${entry.ref} still exposes its incomplete source answer.`);
        assert.equal(entry.quality.verificationStatus, manualChoiceCorrection.verificationStatus, `${entry.ref} correction verification status drifted.`);
        assert.equal(entry.quality.verificationReference, manualChoiceCorrection.verificationReference, `${entry.ref} correction reference drifted.`);
      }
    } else {
      if (entry.issues.includes("manual-text-correction")) {
        const correction = MANUAL_ANSWER_CORRECTIONS.get(entry.ref);
        assert(correction, `${entry.ref} lacks a registered manual correction.`);
        assert(`${entry.payload.question}\n${entry.payload.answer}`.includes(correction.from), `${entry.ref} correction source text is missing.`);
        assert(entry.revision.displayAnswer.includes(correction.to), `${entry.ref} corrected display text is missing.`);
        assert(!entry.revision.displayAnswer.includes(correction.from), `${entry.ref} still displays the reviewed OCR error.`);
      } else if (entry.issues.includes("answer-combined-from-source-fields")) {
        assert(MANUAL_ESSAY_ANSWER_COMBINATIONS.has(entry.ref), `${entry.ref} has an unregistered field combination.`);
        assert(normalizeText(`${entry.payload.question}\n${entry.payload.answer}`).includes(normalizeText(entry.revision.displayAnswer)), `${entry.ref} combined answer is not traceable to its original fields.`);
      } else if (!entry.issues.includes("answer-recovered-from-question")) {
        assert.equal(entry.revision.displayAnswer, entry.payload.answer, `${entry.ref} essay answer must preserve the original standard answer.`);
      } else {
        assert(normalizeText(entry.payload.question).includes(normalizeText(entry.revision.displayAnswer)), `${entry.ref} recovered answer must remain traceable to the original record.`);
      }
      assert(entry.revision.scoringPoints.length >= 3 && entry.revision.scoringPoints.length <= 8, `${entry.ref} needs 3-8 scoring points.`);
      assert(entry.revision.keywords.length >= 2, `${entry.ref} needs at least two keywords.`);
      assert(entry.revision.commonMistakes.length >= 1, `${entry.ref} needs a common-mistake note.`);
      assert((entry.revision.displayAnalysis.match(/[^。！？!?\n]+[。！？!?]?/g) || []).length >= 4, `${entry.ref} essay analysis remains too short.`);
      for (const point of entry.revision.scoringPoints) {
        assert(normalizeText(entry.revision.displayAnswer).includes(normalizeText(point)), `${entry.ref} scoring point is not traceable to its display answer.`);
      }
    }
  }
  for (const group of manifest.report.exactDuplicates) {
    for (const duplicateRef of group.duplicateRefs) {
      const duplicate = manifest.entries.find((entry) => entry.ref === duplicateRef);
      assert.equal(duplicate.quality.canonicalRef, group.canonicalRef, `${duplicateRef} canonical reference mismatch.`);
    }
  }
  assert.equal(manifest.report.totals.hiddenForReview, MANUAL_HIDDEN_REVIEW_REASONS.size, "Reviewed hidden-question total drifted.");
  for (const [duplicateRef, canonicalRef] of MANUAL_HIDDEN_DUPLICATE_CANONICALS) {
    const duplicate = manifest.entries.find((entry) => entry.ref === duplicateRef);
    assert.equal(duplicate.quality.publicationStatus, "hidden_duplicate", `${duplicateRef} must remain hidden.`);
    assert.equal(duplicate.quality.canonicalRef, canonicalRef, `${duplicateRef} reviewed canonical reference drifted.`);
  }
  assert.equal(manifest.entries.filter((entry) => entry.issues.includes("reviewed-conflicting-duplicate")).length, MANUAL_HIDDEN_DUPLICATE_CANONICALS.size, "Reviewed duplicate total drifted.");
  assert.equal(manifest.entries.filter((entry) => entry.revision.correctAnswerOverride && MANUAL_CHOICE_CORRECTIONS.has(entry.ref)).length, MANUAL_CHOICE_CORRECTIONS.size, "Manual choice correction total drifted.");
  assert.equal(manifest.entries.filter((entry) => entry.issues.includes("manual-text-correction")).length, MANUAL_ANSWER_CORRECTIONS.size, "Manual correction total drifted.");
  console.table([manifest.report.totals]);
  console.log("Editorial question quality contract passed without mutating original payloads.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
