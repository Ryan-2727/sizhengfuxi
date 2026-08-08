const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const { loadQuestionBank } = require("./lib/load-question-bank");

const strict = process.argv.includes("--strict");
const courseMinimums = { choice: 500, essay: 50 };
const chapterMinimums = { choice: 10, essay: 2 };

function loadReviewedRules(root) {
  const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const startMarker = "const reviewedQuestionChapterRules = ";
  const endMarker = "\n\nfunction reviewedQuestionChapterInfo";
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error("Reviewed question chapter rules are unavailable.");
  const literal = appSource.slice(start + startMarker.length, end).replace(/;\s*$/, "");
  return vm.runInNewContext(`(${literal})`, Object.create(null));
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

async function main() {
  const root = path.resolve(__dirname, "..");
  const rules = loadReviewedRules(root);
  const { courses } = loadQuestionBank();
  const knowledgeModule = await import(pathToFileURL(path.join(root, "src", "course-knowledge.js")).href);
  const knowledgeByCourse = new Map(knowledgeModule.courseKnowledge.map((course) => [course.id, course]));
  const courseReport = [];
  const weakChapterReport = [];

  for (const course of courses) {
    const knowledge = knowledgeByCourse.get(course.id);
    if (!knowledge) throw new Error(`Missing course knowledge for ${course.id}.`);
    const validChapterIds = new Set(knowledge.chapters.map((chapter) => chapter.id));
    const ruleChapterIds = new Set((rules[course.id] || []).map(([chapterId]) => chapterId));
    for (const chapterId of validChapterIds) {
      if (!ruleChapterIds.has(chapterId)) throw new Error(`${course.id} lacks a reviewed rule for ${chapterId}.`);
    }
    for (const chapterId of ruleChapterIds) {
      if (!validChapterIds.has(chapterId)) throw new Error(`${course.id} has an unknown reviewed chapter rule: ${chapterId}.`);
    }

    const counts = new Map(knowledge.chapters.map((chapter) => [chapter.id, { chapter, choice: 0, essay: 0 }]));
    let unclassifiedChoices = 0;
    let unclassifiedEssays = 0;
    for (const item of course.choices) {
      const chapterId = classifyQuestion(item, course.id, rules);
      if (chapterId && counts.has(chapterId)) counts.get(chapterId).choice += 1;
      else unclassifiedChoices += 1;
    }
    for (const item of course.essays) {
      const chapterId = classifyQuestion(item, course.id, rules);
      if (chapterId && counts.has(chapterId)) counts.get(chapterId).essay += 1;
      else unclassifiedEssays += 1;
    }

    const weakChoices = [...counts.values()].filter((entry) => entry.choice < chapterMinimums.choice);
    const weakEssays = [...counts.values()].filter((entry) => entry.essay < chapterMinimums.essay);
    for (const entry of counts.values()) {
      if (entry.choice >= chapterMinimums.choice && entry.essay >= chapterMinimums.essay) continue;
      weakChapterReport.push({
        course: course.id,
        chapter: entry.chapter.id,
        choices: entry.choice,
        choiceGap: Math.max(0, chapterMinimums.choice - entry.choice),
        essays: entry.essay,
        essayGap: Math.max(0, chapterMinimums.essay - entry.essay)
      });
    }
    courseReport.push({
      course: course.id,
      choices: course.choices.length,
      choiceGap: Math.max(0, courseMinimums.choice - course.choices.length),
      essays: course.essays.length,
      essayGap: Math.max(0, courseMinimums.essay - course.essays.length),
      weakChoiceChapters: weakChoices.length,
      weakEssayChapters: weakEssays.length,
      unclassified: unclassifiedChoices + unclassifiedEssays
    });
  }

  console.table(courseReport);
  if (weakChapterReport.length) {
    console.log(`Chapter floor: ${chapterMinimums.choice} choices and ${chapterMinimums.essay} essays per chapter.`);
    console.table(weakChapterReport);
  }
  const incomplete = courseReport.some((row) => row.choiceGap || row.essayGap || row.weakChoiceChapters || row.weakEssayChapters);
  if (incomplete) {
    console.log("Coverage gaps must be filled with answer-verifiable questions targeted to weak chapters.");
    if (strict) process.exitCode = 1;
  } else {
    console.log("Question-bank total and chapter coverage targets passed.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
