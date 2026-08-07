const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const { loadLocalEnv } = require("./lib/load-local-env");

loadLocalEnv(path.resolve(__dirname, ".."));

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for database verification.");
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const courseIds = ["history", "morality", "mao", "xi", "marx"];
const validAuditStatuses = new Set([
  "teacher-key-verified",
  "textbook-law-verified",
  "authoritative-source-verified",
  "source-backed"
]);

function questionKey(payload) {
  return String(payload?.question || "").replace(/\s+/g, "").trim();
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

async function readRows(courseId, questionType) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("questions")
      .select("id, question_order, payload")
      .eq("course_id", courseId)
      .eq("question_type", questionType)
      .order("question_order", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function main() {
  const summary = [];
  const issues = [];
  for (const courseId of courseIds) {
    for (const questionType of ["choice", "essay"]) {
      const rows = await readRows(courseId, questionType);
      const seen = new Map();
      let missingAnswer = 0;
      let typeMismatch = 0;
      let conciseSourceAnalysis = 0;
      let invalidProvenance = 0;

      for (const row of rows) {
        const key = questionKey(row.payload);
        if (!key) {
          issues.push(`${courseId}/${questionType}: empty question at order ${row.question_order}`);
          continue;
        }
        if (seen.has(key)) issues.push(`${courseId}/${questionType}: exact duplicate at orders ${seen.get(key)} and ${row.question_order}`);
        else seen.set(key, row.question_order);
        if (!String(row.payload.source || "").trim() || !validAuditStatuses.has(row.payload.auditStatus)) {
          invalidProvenance += 1;
          issues.push(`${courseId}/${questionType}: invalid provenance at order ${row.question_order}`);
        }
        if (row.payload.auditStatus !== "source-backed" && !String(row.payload.verificationReference || "").trim()) {
          invalidProvenance += 1;
          issues.push(`${courseId}/${questionType}: missing verification reference at order ${row.question_order}`);
        }

        if (questionType === "choice") {
          const answers = answerLetters(row.payload);
          const options = optionLetters(row.payload.question);
          if (!answers || [...answers].some((letter) => !options.has(letter))) {
            missingAnswer += 1;
            issues.push(`${courseId}/choice: invalid answer at order ${row.question_order}`);
          }
          const expectedType = answers.length > 1 ? "多选题" : "单选题";
          if (row.payload.questionType !== expectedType) {
            typeMismatch += 1;
            issues.push(`${courseId}/choice: type mismatch at order ${row.question_order}`);
          }
          if (String(row.payload.analysis || "").trim().length < 70) conciseSourceAnalysis += 1;
        } else {
          if (String(row.payload.answer || "").trim().length < 120) {
            missingAnswer += 1;
            issues.push(`${courseId}/essay: incomplete standard answer at order ${row.question_order}`);
          }
          if (String(row.payload.analysis || "").trim().length < 50) conciseSourceAnalysis += 1;
        }
      }
      summary.push({ course: courseId, type: questionType, rows: rows.length, missingAnswer, typeMismatch, invalidProvenance, conciseSourceAnalysis });
    }
  }
  console.table(summary);
  if (issues.length) throw new Error(`Question bank verification failed:\n${issues.slice(0, 30).join("\n")}`);
  console.log("Supabase question bank structural contract passed.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
