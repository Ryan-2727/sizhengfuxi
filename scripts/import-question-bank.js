const { createClient } = require("@supabase/supabase-js");
const { createHash } = require("crypto");
const { loadQuestionBank } = require("./lib/load-question-bank");

const dryRun = process.argv.includes("--dry-run");
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!url || !serviceRoleKey)) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const replace = process.argv.includes("--replace");
const supabase = dryRun ? null : createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const { courses } = loadQuestionBank();
const rows = courses.flatMap((course) => [
  ...course.choices.map((payload, index) => ({
    course_id: course.id,
    question_type: "choice",
    question_order: index + 1,
    payload
  })),
  ...course.essays.map((payload, index) => ({
    course_id: course.id,
    question_type: "essay",
    question_order: index + 1,
    payload
  }))
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
      ...course.choices.map((item, index) => ({ question_type: "choice", question_order: index + 1, payload: item })),
      ...course.essays.map((item, index) => ({ question_type: "essay", question_order: index + 1, payload: item }))
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
