const { sha256, stableJson } = require("./editorial-quality");

const DEFAULT_COURSE_IDS = ["history", "morality", "mao", "xi", "marx"];

async function readPaged(queryFactory) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await queryFactory().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function readInChunks(supabase, table, columns, field, values) {
  const rows = [];
  for (let index = 0; index < values.length; index += 100) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in(field, values.slice(index, index + 100));
    if (error) throw error;
    rows.push(...data);
  }
  return rows;
}

async function readCourseQuestionState(supabase, courseId) {
  const questions = await readPaged(() => supabase
    .from("questions")
    .select("id, course_id, question_type, question_order, payload, chapter_id, chapter_assignment_status, chapter_assignment_reference")
    .eq("course_id", courseId)
    .order("question_type", { ascending: true })
    .order("question_order", { ascending: true }));

  if (!questions.length) return [];
  const ids = questions.map((row) => row.id);
  const qualityRows = await readInChunks(
    supabase,
    "question_quality",
    "question_id, publication_status, review_status, canonical_question_id, chapter_confidence, verification_status, source_kind, source_title, source_edition, source_chapter, source_page, source_url, verification_reference, current_revision_id, original_payload_hash, verified_at, curation_status, curation_rank, curation_reason, curation_version, curated_at",
    "question_id",
    ids
  );
  if (qualityRows.length !== questions.length) {
    throw new Error(`${courseId}: question_quality has ${qualityRows.length} rows for ${questions.length} questions. Run the editorial quality migration first.`);
  }

  const qualityByQuestion = new Map(qualityRows.map((row) => [row.question_id, row]));
  const revisionIds = qualityRows.map((row) => row.current_revision_id).filter(Boolean);
  const revisions = revisionIds.length
    ? await readInChunks(
      supabase,
      "question_revisions",
      "id, question_id, revision_no, display_question, display_answer, display_analysis, correct_answer_override, question_type_override, scoring_points, keywords, common_mistakes, revision_note, verification_reference",
      "id",
      revisionIds
    )
    : [];
  const revisionById = new Map(revisions.map((row) => [row.id, row]));

  return questions.map((question) => {
    const quality = qualityByQuestion.get(question.id);
    return {
      question,
      quality,
      revision: quality.current_revision_id ? revisionById.get(quality.current_revision_id) || null : null
    };
  });
}

function catalogPayload(state) {
  return state
    .filter(({ quality }) => quality.publication_status === "published")
    .sort((left, right) => {
      const typeDifference = left.question.question_type.localeCompare(right.question.question_type);
      return typeDifference || left.question.question_order - right.question.question_order;
    })
    .map(({ question, quality, revision }) => ({
      question_type: question.question_type,
      question_order: question.question_order,
      payload: question.payload,
      chapter_id: question.chapter_id,
      chapter_assignment_status: question.chapter_assignment_status,
      chapter_assignment_reference: question.chapter_assignment_reference,
      quality: {
        publication_status: quality.publication_status,
        review_status: quality.review_status,
        canonical_question_id: quality.canonical_question_id,
        chapter_confidence: quality.chapter_confidence,
        verification_status: quality.verification_status,
        source_kind: quality.source_kind,
        source_title: quality.source_title,
        source_edition: quality.source_edition,
        source_chapter: quality.source_chapter,
        source_page: quality.source_page,
        source_url: quality.source_url,
        verification_reference: quality.verification_reference,
        current_revision_id: quality.current_revision_id,
        verified_at: quality.verified_at,
        curation_status: quality.curation_status,
        curation_rank: quality.curation_rank,
        curation_reason: quality.curation_reason,
        curation_version: quality.curation_version,
        curated_at: quality.curated_at
      },
      revision
    }));
}

async function updateQuestionBankCatalog(supabase, courseIds = DEFAULT_COURSE_IDS) {
  const summary = [];
  for (const courseId of courseIds) {
    const state = await readCourseQuestionState(supabase, courseId);
    const payload = catalogPayload(state);
    const row = {
      course_id: courseId,
      choice_count: payload.filter((item) => item.question_type === "choice").length,
      essay_count: payload.filter((item) => item.question_type === "essay").length,
      content_hash: sha256(stableJson(payload))
    };
    const { data: existing, error: readError } = await supabase
      .from("question_bank_catalog")
      .select("content_hash")
      .eq("course_id", courseId)
      .maybeSingle();
    if (readError) throw readError;
    const changed = existing?.content_hash !== row.content_hash;
    if (changed) {
      const { error } = await supabase
        .from("question_bank_catalog")
        .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "course_id" });
      if (error) throw error;
    }
    summary.push({ ...row, changed });
  }
  return summary;
}

module.exports = {
  DEFAULT_COURSE_IDS,
  catalogPayload,
  readCourseQuestionState,
  readInChunks,
  readPaged,
  updateQuestionBankCatalog
};
