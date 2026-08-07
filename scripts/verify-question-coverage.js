const { loadQuestionBank } = require("./lib/load-question-bank");

const strict = process.argv.includes("--strict");
const minimums = { choice: 500, essay: 50 };
const { courses } = loadQuestionBank();
const report = courses.map((course) => {
  const choiceGap = Math.max(0, minimums.choice - course.choices.length);
  const essayGap = Math.max(0, minimums.essay - course.essays.length);
  return {
    course: course.id,
    choices: course.choices.length,
    choiceGap,
    essays: course.essays.length,
    essayGap,
    status: choiceGap || essayGap ? "needs verified additions" : "meets release target"
  };
});

console.table(report);
const incomplete = report.filter((row) => row.choiceGap || row.essayGap);
if (incomplete.length) {
  console.log("Coverage gaps must be filled with answer-verifiable questions before claiming the full paid-bank target.");
  if (strict) process.exitCode = 1;
} else {
  console.log("Question-bank coverage target passed.");
}
