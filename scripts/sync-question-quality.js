const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { buildEditorialManifest } = require("./lib/editorial-manifest");
const { payloadHash, stableJson } = require("./lib/editorial-quality");
const { DEFAULT_COURSE_IDS, readCourseQuestionState, readInChunks, updateQuestionBankCatalog } = require("./lib/question-catalog");
const { loadLocalEnv } = require("./lib/load-local-env");

loadLocalEnv(path.resolve(__dirname, ".."));

const apply = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function databaseRevision(entry) {
  const revision = entry.revision;
  return {
    display_question: revision.displayQuestion,
    display_answer: revision.displayAnswer,
    display_analysis: revision.displayAnalysis,
    correct_answer_override: revision.correctAnswerOverride,
    question_type_override: revision.questionTypeOverride,
    scoring_points: revision.scoringPoints,
    keywords: revision.keywords,
    common_mistakes: revision.commonMistakes,
    revision_note: revision.revisionNote,
    verification_reference: revision.verificationReference
  };
}

function revisionComparable(revision) {
  if (!revision) return null;
  return {
    display_question: revision.display_question,
    display_answer: revision.display_answer,
    display_analysis: revision.display_analysis,
    correct_answer_override: revision.correct_answer_override,
    question_type_override: revision.question_type_override,
    scoring_points: revision.scoring_points || [],
    keywords: revision.keywords || [],
    common_mistakes: revision.common_mistakes || [],
    revision_note: revision.revision_note,
    verification_reference: revision.verification_reference
  };
}

function qualityComparable(quality) {
  if (!quality) return null;
  return {
    question_id: quality.question_id,
    publication_status: quality.publication_status,
    review_status: quality.review_status,
    canonical_question_id: quality.canonical_question_id,
    chapter_confidence: quality.chapter_confidence === null ? null : Number(quality.chapter_confidence),
    verification_status: quality.verification_status,
    source_kind: quality.source_kind,
    source_title: quality.source_title,
    source_edition: quality.source_edition,
    source_chapter: quality.source_chapter,
    source_page: quality.source_page,
    source_url: quality.source_url,
    verification_reference: quality.verification_reference,
    current_revision_id: quality.current_revision_id,
    original_payload_hash: quality.original_payload_hash,
    verified_at: quality.verified_at
  };
}

async function insertRevisions(supabase, rows) {
  const insertedByQuestion = new Map();
  for (let index = 0; index < rows.length; index += 200) {
    const { data, error } = await supabase
      .from("question_revisions")
      .insert(rows.slice(index, index + 200))
      .select("id, question_id");
    if (error) throw error;
    for (const row of data) insertedByQuestion.set(row.question_id, row.id);
  }
  return insertedByQuestion;
}

async function upsertQuality(supabase, rows) {
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await supabase
      .from("question_quality")
      .upsert(rows.slice(index, index + 200), { onConflict: "question_id" });
    if (error) throw error;
  }
}

async function updateChapterCandidates(supabase, rows) {
  let updated = 0;
  for (let index = 0; index < rows.length; index += 25) {
    await Promise.all(rows.slice(index, index + 25).map(async ({ state, entry }) => {
      if (entry.chapter.status !== "candidate" || state.question.chapter_assignment_status === "verified") return;
      if (state.question.chapter_id === entry.chapter.chapterId
        && state.question.chapter_assignment_status === "candidate"
        && state.question.chapter_assignment_reference === entry.chapter.reference) return;
      const { error } = await supabase
        .from("questions")
        .update({
          chapter_id: entry.chapter.chapterId,
          chapter_assignment_status: "candidate",
          chapter_assignment_reference: entry.chapter.reference
        })
        .eq("id", state.question.id)
        .neq("chapter_assignment_status", "verified");
      if (error) throw error;
      updated += 1;
    }));
  }
  return updated;
}

async function applyManifest(supabase, manifest) {
  const stateByRef = new Map();
  const states = [];
  for (const courseId of DEFAULT_COURSE_IDS) {
    const courseState = await readCourseQuestionState(supabase, courseId);
    states.push(...courseState);
    for (const state of courseState) {
      stateByRef.set(`${courseId}:${state.question.question_type}:${state.question.question_order}`, state);
    }
  }
  if (states.length !== manifest.entries.length) {
    throw new Error(`Database has ${states.length} questions; local immutable manifest has ${manifest.entries.length}. Synchronization stopped.`);
  }

  const ids = states.map((state) => state.question.id);
  const allRevisions = await readInChunks(
    supabase,
    "question_revisions",
    "id, question_id, revision_no, display_question, display_answer, display_analysis, correct_answer_override, question_type_override, scoring_points, keywords, common_mistakes, revision_note, verification_reference",
    "question_id",
    ids
  );
  const maxRevision = new Map();
  for (const revision of allRevisions) {
    maxRevision.set(revision.question_id, Math.max(maxRevision.get(revision.question_id) || 0, revision.revision_no));
  }

  const desiredRows = [];
  const revisionRows = [];
  const pairs = [];
  for (const entry of manifest.entries) {
    const state = stateByRef.get(entry.ref);
    if (!state) throw new Error(`${entry.ref} is missing from the database.`);
    const databaseHash = payloadHash(state.question.payload);
    if (databaseHash !== entry.originalPayloadHash) {
      throw new Error(`${entry.ref} immutable payload mismatch: expected ${entry.originalPayloadHash}, received ${databaseHash}.`);
    }
    pairs.push({ state, entry });
    const desiredRevision = databaseRevision(entry);
    const currentRevision = state.revision;
    const unchanged = stableJson(revisionComparable(currentRevision)) === stableJson(desiredRevision);
    if (!unchanged) {
      revisionRows.push({
        question_id: state.question.id,
        revision_no: (maxRevision.get(state.question.id) || 0) + 1,
        ...desiredRevision
      });
    }
    desiredRows.push({ state, entry, currentRevisionId: unchanged ? currentRevision?.id || null : null });
  }

  const insertedByQuestion = await insertRevisions(supabase, revisionRows);
  const idByRef = new Map(pairs.map(({ state, entry }) => [entry.ref, state.question.id]));
  const now = new Date().toISOString();
  const qualityRowsWithState = desiredRows.map(({ state, entry, currentRevisionId }) => ({
    state,
    row: {
      question_id: state.question.id,
      publication_status: entry.quality.publicationStatus,
      review_status: entry.quality.reviewStatus,
      canonical_question_id: entry.quality.canonicalRef ? idByRef.get(entry.quality.canonicalRef) : null,
      chapter_confidence: entry.chapter.confidence,
      verification_status: entry.quality.verificationStatus,
      source_kind: entry.quality.sourceKind,
      source_title: entry.quality.sourceTitle,
      source_edition: entry.quality.sourceEdition,
      source_chapter: entry.quality.sourceChapter,
      source_page: entry.quality.sourcePage,
      source_url: entry.quality.sourceUrl,
      verification_reference: entry.quality.verificationReference,
      current_revision_id: currentRevisionId || insertedByQuestion.get(state.question.id),
      original_payload_hash: state.quality.original_payload_hash,
      verified_at: entry.quality.reviewStatus === "source_verified" ? state.quality.verified_at || now : null
    }
  }));
  const qualityRows = qualityRowsWithState
    .filter(({ state, row }) => stableJson(qualityComparable(state.quality)) !== stableJson(qualityComparable(row)))
    .map(({ row }) => row);
  await upsertQuality(supabase, qualityRows);
  const chapterUpdates = await updateChapterCandidates(supabase, pairs);
  const catalog = await updateQuestionBankCatalog(supabase, DEFAULT_COURSE_IDS);
  return {
    qualityRowsChecked: qualityRowsWithState.length,
    qualityRowsUpdated: qualityRows.length,
    newRevisions: revisionRows.length,
    reusedRevisions: qualityRowsWithState.length - revisionRows.length,
    chapterUpdates,
    catalogChanged: catalog.filter((row) => row.changed).length
  };
}

async function main() {
  const manifest = await buildEditorialManifest();
  console.table([manifest.report.totals]);
  if (!apply) {
    console.log("Report only. Run npm run questions:sync-quality -- --apply after executing the editorial quality migration.");
    return;
  }
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply.");
  }
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const summary = await applyManifest(supabase, manifest);
  console.table([summary]);
  console.log("Question quality synchronized. No questions.payload value was updated.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
