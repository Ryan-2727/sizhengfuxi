const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

async function main() {
  const root = path.resolve(__dirname, "..");
  const tools = await import(pathToFileURL(path.join(root, "src", "study-tools.js")).href);
  const items = [];
  for (let index = 0; index < 60; index += 1) {
    items.push({
      questionId: `single-${index}`,
      type: "选择题",
      questionType: "单选题",
      correctAnswer: "A",
      question: `第${index}道单选题`,
      chapterInfo: { id: `chapter-${index % 8}` },
      importance: index % 3 === 0 ? "高频" : "基础"
    });
  }
  for (let index = 0; index < 24; index += 1) {
    items.push({
      questionId: `multiple-${index}`,
      type: "选择题",
      questionType: "多选题",
      correctAnswer: "ABC",
      question: `第${index}道多选题`,
      chapterInfo: { id: `chapter-${index % 8}` }
    });
  }
  for (let index = 0; index < 8; index += 1) {
    items.push({
      questionId: `essay-${index}`,
      type: "大题",
      question: `第${index}道大题`,
      chapterInfo: { id: `chapter-${index}` }
    });
  }

  const exam = tools.buildMockExam(items, { random: () => 0.42 });
  assert.equal(exam.questionIds.length, 43, "Mock exam must contain 40 choices and 3 essays.");
  assert.equal(new Set(exam.questionIds).size, exam.questionIds.length, "Mock exam contains duplicate questions.");
  assert.equal(exam.choiceCount, 40, "Mock exam choice count drifted.");
  assert.equal(exam.essayCount, 3, "Mock exam essay count drifted.");
  assert(exam.chapterCount >= 6, "Mock exam should cover multiple chapters.");
  assert.equal(tools.questionDifficulty(items[60]), "较难", "Multiple-choice difficulty label drifted.");
  assert.equal(tools.questionFrequency(items[0]), "高频", "Frequency label drifted.");
  assert.equal(tools.inferWrongReason(items[60], "AB", "ABC"), "multi-omission", "Multiple-choice omission classification drifted.");
  assert.equal(tools.inferWrongReason({ type: "选择题", question: "下列说法不正确的是" }, "B", "A"), "reading-error", "Negative-stem classification drifted.");
  assert(tools.CONTENT_CHANGELOG.length >= 1, "Content changelog is empty.");

  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  for (const contract of [
    "data-start-mock-exam",
    "data-wrong-reason",
    "data-knowledge-questions",
    "data-knowledge-link",
    "data-question-feedback",
    "renderContentChangelog"
  ]) assert(app.includes(contract), `Study UI contract is missing ${contract}.`);
  assert(html.includes('id="feedbackContext"'), "Feedback context notice is missing.");
  console.log("Study tools verified: mock exam, labels, wrong reasons, knowledge links, feedback context and changelog.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
