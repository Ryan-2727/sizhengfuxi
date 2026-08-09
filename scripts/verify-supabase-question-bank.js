const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { normalizeText } = require("./lib/editorial-quality");
const { DEFAULT_COURSE_IDS, readCourseQuestionState } = require("./lib/question-catalog");
const { loadLocalEnv } = require("./lib/load-local-env");

loadLocalEnv(path.resolve(__dirname, ".."));

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for database verification.");
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const validVerificationStatuses = new Set([
  "teacher-key-verified",
  "textbook-law-verified",
  "authoritative-source-verified",
  "source-backed",
  "pending"
]);

function applyRevision(payload, revision) {
  const effective = { ...payload };
  if (revision?.display_question) effective.question = revision.display_question;
  if (revision?.display_answer) effective.answer = revision.display_answer;
  if (revision?.display_analysis) effective.analysis = revision.display_analysis;
  if (revision?.correct_answer_override) effective.correctAnswer = revision.correct_answer_override;
  if (revision?.question_type_override) effective.questionType = revision.question_type_override;
  return effective;
}

function answerLetters(payload) {
  const direct = String(payload?.correctAnswer || "").match(/[A-F]/gi);
  if (direct?.length) return [...new Set(direct.map((item) => item.toUpperCase()))].sort().join("");
  const fromAnswer = String(payload?.answer || "").match(/正确答案[:：]\s*([A-F]{1,6})/i);
  return fromAnswer ? [...new Set(fromAnswer[1].toUpperCase())].sort().join("") : "";
}

function optionLetters(question) {
  return new Set([...String(question || "").matchAll(/(?:^|\n|\s)([A-F])(?:[.．、]\s*|\s+|(?=[\u4e00-\u9fff]))/g)].map((match) => match[1]));
}

function analysisSentenceCount(value) {
  return (String(value || "").match(/[^。！？!?\n]+[。！？!?]?/g) || []).length;
}

async function main() {
  const summary = [];
  const issues = [];
  for (const courseId of DEFAULT_COURSE_IDS) {
    const states = await readCourseQuestionState(supabase, courseId);
    const published = states.filter((state) => state.quality.publication_status === "published");
    const seen = new Map();
    for (const state of states) {
      const { question, quality, revision } = state;
      if (!/^[a-f0-9]{64}$/.test(quality.original_payload_hash || "")) {
        issues.push(`${courseId}/${question.question_type}/${question.question_order}: invalid immutable payload hash`);
      }
      if (!validVerificationStatuses.has(quality.verification_status)) {
        issues.push(`${courseId}/${question.question_type}/${question.question_order}: invalid verification status`);
      }
      if (quality.publication_status === "hidden_duplicate" && !quality.canonical_question_id) {
        issues.push(`${courseId}/${question.question_type}/${question.question_order}: hidden duplicate lacks canonical question`);
      }
      if (quality.publication_status !== "published") continue;
      if (!revision || quality.current_revision_id !== revision.id) {
        issues.push(`${courseId}/${question.question_type}/${question.question_order}: current revision is missing`);
        continue;
      }
      const effective = applyRevision(question.payload, revision);
      const duplicateKey = `${question.question_type}:${normalizeText(effective.question)}`;
      if (seen.has(duplicateKey)) {
        issues.push(`${courseId}/${question.question_type}: published duplicate at orders ${seen.get(duplicateKey)} and ${question.question_order}`);
      } else {
        seen.set(duplicateKey, question.question_order);
      }
      if (question.question_type === "choice") {
        const answers = answerLetters(effective);
        const options = optionLetters(effective.question);
        if (!answers || [...answers].some((letter) => !options.has(letter))) {
          issues.push(`${courseId}/choice/${question.question_order}: invalid effective answer`);
        }
        const expectedType = answers.length > 1 ? "多选题" : "单选题";
        if (effective.questionType !== expectedType) {
          issues.push(`${courseId}/choice/${question.question_order}: effective type mismatch`);
        }
        if (analysisSentenceCount(effective.analysis) < 2) {
          issues.push(`${courseId}/choice/${question.question_order}: effective analysis is too short`);
        }
      } else {
        if (String(effective.answer || "").trim().length < 40) {
          issues.push(`${courseId}/essay/${question.question_order}: effective standard answer is incomplete`);
        }
        if (!Array.isArray(revision.scoring_points) || revision.scoring_points.length < 3) {
          issues.push(`${courseId}/essay/${question.question_order}: scoring points are incomplete`);
        }
        if (!Array.isArray(revision.keywords) || revision.keywords.length < 2) {
          issues.push(`${courseId}/essay/${question.question_order}: keywords are incomplete`);
        }
        if (!Array.isArray(revision.common_mistakes) || revision.common_mistakes.length < 1) {
          issues.push(`${courseId}/essay/${question.question_order}: common-mistake guidance is incomplete`);
        }
      }
    }

    const { data: catalog, error: catalogError } = await supabase
      .from("question_bank_catalog")
      .select("choice_count, essay_count, content_hash")
      .eq("course_id", courseId)
      .single();
    if (catalogError) throw catalogError;
    const choices = published.filter((state) => state.question.question_type === "choice").length;
    const essays = published.filter((state) => state.question.question_type === "essay").length;
    if (catalog.choice_count !== choices || catalog.essay_count !== essays || !/^[a-f0-9]{64}$/.test(catalog.content_hash || "")) {
      issues.push(`${courseId}: catalog does not match published question counts/hash`);
    }
    summary.push({
      course: courseId,
      originals: states.length,
      published: published.length,
      hidden: states.length - published.length,
      choices,
      essays
    });
  }
  console.table(summary);
  if (issues.length) throw new Error(`Supabase editorial verification failed:\n${issues.slice(0, 40).join("\n")}`);
  console.log("Supabase question quality, revisions, publication state and catalog passed.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
