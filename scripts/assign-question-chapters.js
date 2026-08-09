const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { createHash } = require("crypto");
const { pathToFileURL } = require("url");
const { loadQuestionBank } = require("./lib/load-question-bank");
const { loadLocalEnv } = require("./lib/load-local-env");

loadLocalEnv(path.resolve(__dirname, ".."));

const apply = process.argv.includes("--apply-candidates");
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const courseIds = ["history", "morality", "mao", "xi", "marx"];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function classifyQuestion(item, courseId, rules) {
  const text = `${item.question || ""}\n${item.answer || ""}\n${item.analysis || ""}`;
  const matches = (rules[courseId] || []).map(([chapterId, terms]) => ({
    chapterId,
    score: terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0)
  })).sort((left, right) => right.score - left.score);
  const best = matches[0];
  if (!best || best.score === 0 || (matches[1] && best.score === matches[1].score)) return null;
  return best.chapterId;
}

function localReport(rules) {
  const { courses } = loadQuestionBank();
  const rows = courses.map((course) => {
    const questions = [...course.choices, ...course.essays];
    const candidates = questions.filter((item) => classifyQuestion(item, course.id, rules)).length;
    return { course: course.id, total: questions.length, candidates, unclassified: questions.length - candidates };
  });
  console.table(rows);
}

async function readUnclassifiedRows(supabase, courseId) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("questions")
      .select("id, course_id, payload")
      .eq("course_id", courseId)
      .eq("chapter_assignment_status", "unclassified")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function applyCandidates(supabase, rules) {
  const report = [];
  for (const courseId of courseIds) {
    const rows = await readUnclassifiedRows(supabase, courseId);
    const candidates = rows.map((row) => ({ ...row, chapterId: classifyQuestion(row.payload, courseId, rules) }))
      .filter((row) => row.chapterId);
    for (let index = 0; index < candidates.length; index += 50) {
      await Promise.all(candidates.slice(index, index + 50).map(async (row) => {
        const { error } = await supabase
          .from("questions")
          .update({
            chapter_id: row.chapterId,
            chapter_assignment_status: "candidate",
            chapter_assignment_reference: "keyword-rules-v1"
          })
          .eq("id", row.id)
          .eq("chapter_assignment_status", "unclassified");
        if (error) throw error;
      }));
    }
    report.push({ course: courseId, scanned: rows.length, candidates: candidates.length, stillUnclassified: rows.length - candidates.length });
  }
  await refreshCatalog(supabase);
  console.table(report);
}

async function refreshCatalog(supabase) {
  for (const courseId of courseIds) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("questions")
        .select("question_type, question_order, payload, chapter_id, chapter_assignment_status, chapter_assignment_reference")
        .eq("course_id", courseId)
        .order("question_type")
        .order("question_order")
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    const ordered = rows.map((row) => ({
      question_type: row.question_type,
      question_order: row.question_order,
      payload: row.payload,
      chapter_id: row.chapter_id,
      chapter_assignment_status: row.chapter_assignment_status,
      chapter_assignment_reference: row.chapter_assignment_reference
    }));
    const contentHash = createHash("sha256").update(stableJson(ordered)).digest("hex");
    const { data: existing, error: readError } = await supabase
      .from("question_bank_catalog")
      .select("content_hash")
      .eq("course_id", courseId)
      .maybeSingle();
    if (readError) throw readError;
    if (existing?.content_hash === contentHash) continue;
    const { error } = await supabase.from("question_bank_catalog").upsert({
      course_id: courseId,
      choice_count: rows.filter((row) => row.question_type === "choice").length,
      essay_count: rows.filter((row) => row.question_type === "essay").length,
      content_hash: contentHash,
      updated_at: new Date().toISOString()
    }, { onConflict: "course_id" });
    if (error) throw error;
  }
}

async function main() {
  const rulesModule = await import(pathToFileURL(path.join(__dirname, "..", "src", "question-chapter-rules.js")).href);
  const rules = rulesModule.reviewedQuestionChapterRules;
  if (!apply) {
    localReport(rules);
    console.log("Report only. Run with --apply-candidates after the database migration to write candidate metadata.");
    return;
  }
  if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply-candidates.");
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  await applyCandidates(supabase, rules);
  console.log("Only previously unclassified rows were marked as candidates; verified rows and question content were not changed.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
