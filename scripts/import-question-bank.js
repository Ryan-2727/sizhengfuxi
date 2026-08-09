const { createClient } = require("@supabase/supabase-js");
const { createHash } = require("crypto");
const { loadQuestionBank } = require("./lib/load-question-bank");
const { loadLocalEnv } = require("./lib/load-local-env");

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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

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
      content_hash: createHash("sha256").update(stableJson(payload)).digest("hex")
    };
  });
}

async function updateCatalog() {
  for (const row of catalogRows()) {
    const { data: existing, error: readError } = await supabase
      .from("question_bank_catalog")
      .select("content_hash")
      .eq("course_id", row.course_id)
      .maybeSingle();
    if (readError) throw readError;
    if (existing?.content_hash === row.content_hash) continue;
    const { error } = await supabase
      .from("question_bank_catalog")
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "course_id" });
    if (error) throw error;
  }
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
  for (const course of courses) {
    const [choices, essays] = await Promise.all([
      readCourseQuestions(course.id, "choice"),
      readCourseQuestions(course.id, "essay")
    ]);
    const payload = [...choices, ...essays]
      .sort((left, right) => left.question_type.localeCompare(right.question_type) || left.question_order - right.question_order)
      .map((item) => ({
        question_type: item.question_type,
        question_order: item.question_order,
        payload: item.payload,
        chapter_id: item.chapter_id,
        chapter_assignment_status: item.chapter_assignment_status,
        chapter_assignment_reference: item.chapter_assignment_reference
      }));
    const row = {
      course_id: course.id,
      choice_count: choices.length,
      essay_count: essays.length,
      content_hash: createHash("sha256").update(stableJson(payload)).digest("hex"),
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from("question_bank_catalog").upsert(row, { onConflict: "course_id" });
    if (error) throw error;
  }
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
        if (stableJson(current.payload) === stableJson(payload)) continue;
        const { error } = await supabase.from("questions").update({ payload, ...chapterAssignment(payload) }).eq("id", current.id);
        if (error) throw error;
        updated += 1;
      }
    }
    summary.push({ course: course.id, updated, skipped });
  }
  await updateCatalogFromDatabase();
  console.table(summary);
  console.log("Synced curated question quality without changing original question rows.");
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
  if (count && !replace) {
    throw new Error(`questions already contains ${count} rows. Re-run with --replace to intentionally replace it.`);
  }
  if (replace) {
    const { error } = await supabase.from("questions").delete().not("id", "is", null);
    if (error) throw error;
  }
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase.from("questions").insert(rows.slice(index, index + 500));
    if (error) throw error;
  }
  await updateCatalog();
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
