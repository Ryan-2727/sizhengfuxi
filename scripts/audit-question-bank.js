const fs = require("fs");
const path = require("path");
const { loadQuestionBank, sourceDirectory } = require("./lib/load-question-bank");

const root = path.resolve(__dirname, "..");
const outputDir = root;
const { courses, parseChoiceOptions, choiceAnswerLetters, choiceAnalysis, stableQuestionId } = loadQuestionBank();
const validAuditStatuses = new Set([
  "teacher-key-verified",
  "textbook-law-verified",
  "authoritative-source-verified",
  "source-backed"
]);
const report = {
  generatedAt: new Date().toISOString(),
  policy: "Only source-backed questions passing structural and relevance checks are included in the formal bank.",
  courses: [],
  issues: []
};

for (const course of courses) {
  const sourceCounts = {};
  const auditStatusCounts = {};
  const ids = new Set();
  const reviewReasons = {};
  const reviewSamples = [];
  const riskSamples = [];
  const questions = [
    ...course.choices.map((item) => ({ ...item, courseId: course.id, type: "选择题" })),
    ...course.essays.map((item) => ({ ...item, courseId: course.id, type: "大题" }))
  ];

  for (const item of questions) {
    sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
    auditStatusCounts[item.auditStatus] = (auditStatusCounts[item.auditStatus] || 0) + 1;
    const id = stableQuestionId(item);
    if (ids.has(id)) report.issues.push(`${course.id}: duplicate stable id ${id}`);
    ids.add(id);

    if (item.type === "选择题") {
      const options = parseChoiceOptions(item.question);
      const letters = choiceAnswerLetters(item);
      const stem = item.question.split(/(?:^|\n)\s*[A-FＡ-Ｆ][.．、]\s*/)[0];
      const stemWithoutLeadingNumber = stem.replace(/^\s*\d{1,3}[.．、]\s*/, "");
      if (Object.keys(options).length < 2) report.issues.push(`${course.id}: incomplete options: ${item.question.slice(0, 40)}`);
      if (!letters || [...letters].some((letter) => !options[letter])) report.issues.push(`${course.id}: invalid answer: ${item.question.slice(0, 40)}`);
      const expectedType = letters.length > 1 ? "多选题" : "单选题";
      if (item.questionType !== expectedType) report.issues.push(`${course.id}: type mismatch: ${item.question.slice(0, 40)}`);
      const renderedAnalysis = choiceAnalysis(item);
      if (renderedAnalysis.length < 70) report.issues.push(`${course.id}: weak choice analysis: ${item.question.slice(0, 40)}`);
      if (/(?:^|\s)\d{1,3}[.．、]\s*[^。\n]{0,80}[（(]\s*[）)]/.test(stemWithoutLeadingNumber)) {
        report.issues.push(`${course.id}: possible next-question leakage: ${item.question.slice(0, 60)}`);
      }
      if (riskSamples.length < 12 && /不包括|不正确|错误的是|不是|没有|未|根本|核心|标志|首次|最早|时间是|哪一年|多少年/.test(item.question)) {
        riskSamples.push({
          question: item.question,
          correctAnswer: item.correctAnswer,
          source: item.source
        });
      }
    } else {
      if ((item.answer || "").length < 120) report.issues.push(`${course.id}: short essay answer: ${item.question.slice(0, 40)}`);
      if ((item.analysis || "").length < 50) report.issues.push(`${course.id}: weak essay analysis: ${item.question.slice(0, 40)}`);
      if (/应从.{0,12}(方面|层次)回答|答题角度|这类题/.test(item.answer || "")) {
        report.issues.push(`${course.id}: essay answer contains method-only guidance: ${item.question.slice(0, 40)}`);
      }
      if (/补充作答|补充得分点|考试作答时|标准答案通常需要/.test(item.answer || "")) {
        report.issues.push(`${course.id}: essay answer contains generic scoring guidance: ${item.question.slice(0, 40)}`);
      }
    }

    if (!(item.source || "").trim()) report.issues.push(`${course.id}: missing source: ${item.question.slice(0, 40)}`);
    if (!validAuditStatuses.has(item.auditStatus)) {
      report.issues.push(`${course.id}: invalid audit status "${item.auditStatus || ""}": ${item.question.slice(0, 40)}`);
    }
    if (item.auditStatus !== "source-backed" && !(item.verificationReference || "").trim()) {
      report.issues.push(`${course.id}: verified item missing reference: ${item.question.slice(0, 40)}`);
    }
    if (/强化变式编号|联网公开题库与教材框架补充/.test(`${item.question}${item.source || ""}`)) {
      report.issues.push(`${course.id}: generated variant in formal bank: ${item.question.slice(0, 40)}`);
    }
    if (/\?{5,}|�/.test(`${item.question}${item.answer || ""}${item.analysis || ""}`)) {
      report.issues.push(`${course.id}: encoding noise: ${item.question.slice(0, 40)}`);
    }
  }

  for (const item of [...course.reviewQueue.choices, ...course.reviewQueue.essays]) {
    for (const reason of item.auditReasons) reviewReasons[reason] = (reviewReasons[reason] || 0) + 1;
    reviewSamples.push({
      question: item.question,
      source: item.source,
      reasons: item.auditReasons
    });
  }

  report.courses.push({
    id: course.id,
    formalChoices: course.choices.length,
    formalEssays: course.essays.length,
    reviewChoices: course.reviewQueue.choices.length,
    reviewEssays: course.reviewQueue.essays.length,
    reviewReasons,
    reviewSamples,
    excludedQuestions: (course.excludedQuestions || []).map((item) => ({
      question: item.question,
      source: item.source,
      reason: item.exclusionReason
    })),
    riskSamples,
    sourceCounts,
    auditStatusCounts
  });
}

if (process.argv.includes("--write")) {
  fs.writeFileSync(path.join(sourceDirectory, "question-audit-report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (!process.argv.includes("--quiet")) console.log(JSON.stringify(report, null, 2));
if (report.issues.length) process.exitCode = 1;
