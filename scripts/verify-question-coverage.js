const path = require("path");
const { pathToFileURL } = require("url");
const { loadQuestionBank } = require("./lib/load-question-bank");
const { buildEditorialManifest } = require("./lib/editorial-manifest");

const strict = process.argv.includes("--strict");
const courseMinimums = { choice: 500, essay: 50 };
const chapterMinimums = { choice: 10, essay: 2 };

async function main() {
  const root = path.resolve(__dirname, "..");
  const rulesModule = await import(pathToFileURL(path.join(root, "src", "question-chapter-rules.js")).href);
  const rules = rulesModule.reviewedQuestionChapterRules;
  const { courses } = loadQuestionBank();
  const manifest = await buildEditorialManifest();
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
    const published = manifest.entries.filter((entry) => entry.courseId === course.id && entry.quality.publicationStatus === "published");
    let unclassifiedChoices = 0;
    let unclassifiedEssays = 0;
    for (const entry of published) {
      const chapterId = entry.chapter.chapterId;
      if (chapterId && counts.has(chapterId)) counts.get(chapterId)[entry.questionType] += 1;
      else if (entry.questionType === "choice") unclassifiedChoices += 1;
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
      choices: published.filter((entry) => entry.questionType === "choice").length,
      choiceGap: Math.max(0, courseMinimums.choice - published.filter((entry) => entry.questionType === "choice").length),
      essays: published.filter((entry) => entry.questionType === "essay").length,
      essayGap: Math.max(0, courseMinimums.essay - published.filter((entry) => entry.questionType === "essay").length),
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
    console.log("Published coverage gaps must be filled with answer-verifiable questions targeted to weak chapters.");
    if (strict) process.exitCode = 1;
  } else {
    console.log("Published question-bank total and chapter coverage targets passed.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
