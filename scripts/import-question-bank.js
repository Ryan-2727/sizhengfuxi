const { createClient } = require("@supabase/supabase-js");
const { loadQuestionBank } = require("./lib/load-question-bank");
const { loadLocalEnv } = require("./lib/load-local-env");
const { sha256, sourceMetadata, stableJson } = require("./lib/editorial-quality");
const { updateQuestionBankCatalog } = require("./lib/question-catalog");

loadLocalEnv(require("path").resolve(__dirname, ".."));

const dryRun = process.argv.includes("--dry-run");
const catalogOnly = process.argv.includes("--catalog-only");
const appendCurated = process.argv.includes("--append-curated");
const syncCurated = process.argv.includes("--sync-curated");
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!url || !serviceRoleKey)) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const replace = process.argv.includes("--replace");
const supabase = dryRun ? null : createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const { courses } = loadQuestionBank();

function chapterAssignment(payload) {
  const chapterId = String(payload?.chapterId || "").trim();
  const status = chapterId && ["candidate", "verified"].includes(payload?.chapterAssignmentStatus)
    ? payload.chapterAssignmentStatus
    : "unclassified";
  return {
    chapter_id: status === "unclassified" ? null : chapterId,
    chapter_assignment_status: status,
    chapter_assignment_reference: payload?.chapterAssignmentReference || null
  };
}

function questionRow(courseId, questionType, questionOrder, payload) {
  return {
    course_id: courseId,
    question_type: questionType,
    question_order: questionOrder,
    payload,
    ...chapterAssignment(payload)
  };
}

const rows = courses.flatMap((course) => [
  ...course.choices.map((payload, index) => questionRow(course.id, "choice", index + 1, payload)),
  ...course.essays.map((payload, index) => questionRow(course.id, "essay", index + 1, payload))
]);

function catalogRows() {
  return courses.map((course) => {
    const payload = [
      ...course.choices.map((item, index) => ({ question_type: "choice", question_order: index + 1, payload: item, ...chapterAssignment(item) })),
      ...course.essays.map((item, index) => ({ question_type: "essay", question_order: index + 1, payload: item, ...chapterAssignment(item) }))
    ];
    return {
      course_id: course.id,
      choice_count: course.choices.length,
      essay_count: course.essays.length,
      content_hash: sha256(stableJson(payload))
    };
  });
}

async function readCourseQuestions(courseId, questionType) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("questions")
      .select("id, course_id, question_type, question_order, payload, chapter_id, chapter_assignment_status, chapter_assignment_reference")
      .eq("course_id", courseId)
      .eq("question_type", questionType)
      .order("question_order", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function questionKey(payload) {
  return String(payload?.question || "").replace(/\s+/g, "").trim();
}

function isCuratedAddition(payload) {
  return typeof payload?.source === "string" && (
    payload.source === "精选补充题" || payload.source === "用户提供真题（已核验）"
  );
}

async function updateCatalogFromDatabase() {
  const summary = await updateQuestionBankCatalog(supabase, courses.map((course) => course.id));
  console.table(summary.map(({ course_id, choice_count, essay_count, changed }) => ({ course_id, choice_count, essay_count, changed })));
}

function applyRevision(payload, revision) {
  const next = { ...payload };
  if (revision?.display_question) next.question = revision.display_question;
  if (revision?.display_answer) next.answer = revision.display_answer;
  if (revision?.display_analysis) next.analysis = revision.display_analysis;
  if (revision?.correct_answer_override) next.correctAnswer = revision.correct_answer_override;
  if (revision?.question_type_override) next.questionType = revision.question_type_override;
  return next;
}

function curatedRevision(current, desired) {
  const revision = {
    display_question: current.question === desired.question ? null : desired.question,
    display_answer: current.answer === desired.answer ? null : desired.answer,
    display_analysis: current.analysis === desired.analysis ? null : desired.analysis,
    correct_answer_override: current.correctAnswer === desired.correctAnswer ? null : desired.correctAnswer,
    question_type_override: current.questionType === desired.questionType ? null : desired.questionType,
    scoring_points: [],
    keywords: [],
    common_mistakes: [],
    revision_note: "Reviewed curated-source synchronization",
    verification_reference: desired.verificationReference || null
  };
  return Object.values(revision).some((value, index) => index < 5 && value) ? revision : null;
}

async function appendCuratedQuestions() {
  const summary = [];
  for (const course of courses) {
    const additions = {
      choice: course.choices.filter(isCuratedAddition),
      essay: course.essays.filter(isCuratedAddition)
    };
    let added = 0;
    let skipped = 0;
    for (const [questionType, items] of Object.entries(additions)) {
      if (!items.length) continue;
      const existing = await readCourseQuestions(course.id, questionType);
      const existingKeys = new Set(existing.map((item) => questionKey(item.payload)));
      let order = existing.reduce((max, item) => Math.max(max, item.question_order), 0);
      const rowsToInsert = [];
      for (const payload of items) {
        if (existingKeys.has(questionKey(payload))) {
          skipped += 1;
          continue;
        }
        order += 1;
        existingKeys.add(questionKey(payload));
        rowsToInsert.push(questionRow(course.id, questionType, order, payload));
      }
      if (rowsToInsert.length) {
        const { error } = await supabase.from("questions").insert(rowsToInsert);
        if (error) throw error;
        added += rowsToInsert.length;
      }
    }
    summary.push({ course: course.id, added, skipped });
  }
  await updateCatalogFromDatabase();
  console.table(summary);
  console.log("Appended curated questions without replacing existing question rows.");
}

async function syncCuratedQuestions() {
  const summary = [];
  for (const course of courses) {
    let updated = 0;
    let skipped = 0;
    for (const [questionType, items] of Object.entries({
      choice: course.choices.filter(isCuratedAddition),
      essay: course.essays.filter(isCuratedAddition)
    })) {
      if (!items.length) continue;
      const existing = await readCourseQuestions(course.id, questionType);
      const byQuestion = new Map(existing.map((item) => [questionKey(item.payload), item]));
      for (const payload of items) {
        const current = byQuestion.get(questionKey(payload));
        if (!current || !isCuratedAddition(current.payload)) {
          skipped += 1;
          continue;
        }
        const { data: quality, error: qualityError } = await supabase
          .from("question_quality")
          .select("current_revision_id")
          .eq("question_id", current.id)
          .single();
        if (qualityError) throw qualityError;
        let activeRevision = null;
        if (quality.current_revision_id) {
          const { data, error } = await supabase
            .from("question_revisions")
            .select("display_question, display_answer, display_analysis, correct_answer_override, question_type_override")
            .eq("id", quality.current_revision_id)
            .single();
          if (error) throw error;
          activeRevision = data;
        }
        const revision = curatedRevision(applyRevision(current.payload, activeRevision), payload);
        if (!revision) continue;
        const { data: latest, error: latestError } = await supabase
          .from("question_revisions")
          .select("revision_no")
          .eq("question_id", current.id)
          .order("revision_no", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestError) throw latestError;
        const { data: inserted, error: revisionError } = await supabase
          .from("question_revisions")
          .insert({ question_id: current.id, revision_no: (latest?.revision_no || 0) + 1, ...revision })
          .select("id")
          .single();
        if (revisionError) throw revisionError;
        const source = sourceMetadata(payload);
        const { error: updateError } = await supabase
          .from("question_quality")
          .update({
            current_revision_id: inserted.id,
            review_status: source.verificationStatus === "pending" ? "structural_checked" : "source_verified",
            verification_status: source.verificationStatus,
            source_kind: source.sourceKind,
            source_title: source.sourceTitle,
            verification_reference: source.verificationReference
          })
          .eq("question_id", current.id);
        if (updateError) throw updateError;
        updated += 1;
      }
    }
    summary.push({ course: course.id, updated, skipped });
  }
  await updateCatalogFromDatabase();
  console.table(summary);
  console.log("Synced curated display revisions without changing questions.payload.");
}

async function main() {
  if (dryRun) {
    console.table(courses.map((course) => ({
      course: course.id,
      choices: course.choices.length,
      essays: course.essays.length
    })));
    console.table(catalogRows().map(({ course_id, choice_count, essay_count, content_hash }) => ({ course_id, choice_count, essay_count, content_hash })));
    console.log(`Validated ${rows.length} questions without writing to Supabase.`);
    return;
  }
  if (catalogOnly) {
    await updateCatalogFromDatabase();
    console.log("Updated question bank catalog without changing question rows.");
    return;
  }
  if (appendCurated) {
    await appendCuratedQuestions();
    return;
  }
  if (syncCurated) {
    await syncCuratedQuestions();
    return;
  }
  const { count, error: countError } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true });
  if (countError) throw countError;
  if (count) {
    const hint = replace
      ? "--replace is disabled because original question rows are immutable. Use --append-curated or --sync-curated."
      : "Use --append-curated, --sync-curated, or --catalog-only instead.";
    throw new Error(`questions already contains ${count} rows. ${hint}`);
  }
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase.from("questions").insert(rows.slice(index, index + 500));
    if (error) throw error;
  }
  await updateCatalogFromDatabase();
  const summary = courses.map((course) => ({
    course: course.id,
    choices: course.choices.length,
    essays: course.essays.length
  }));
  console.table(summary);
  console.log(`Imported ${rows.length} questions.`);
}

main().catch((error) => {
  console.error(JSON.stringify({
    name: error?.name || "SupabaseError",
    message: error?.message || "(no error message returned)",
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
    status: error?.status || null,
    cause: error?.cause?.message || null
  }, null, 2));
  process.exitCode = 1;
});
