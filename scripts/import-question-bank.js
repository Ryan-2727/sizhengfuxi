const { createClient } = require("@supabase/supabase-js");
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

async function main() {
  if (dryRun) {
    console.table(courses.map((course) => ({
      course: course.id,
      choices: course.choices.length,
      essays: course.essays.length
    })));
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
