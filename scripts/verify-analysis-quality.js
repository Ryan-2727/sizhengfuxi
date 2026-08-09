const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
const { loadQuestionBank } = require("./lib/load-question-bank");

async function main() {
  const analysisModule = await import(pathToFileURL(path.join(__dirname, "..", "src", "question-analysis.js")).href);
  const { courses, parseChoiceOptions, choiceAnswerLetters } = loadQuestionBank();
  const summary = [];

  for (const course of courses) {
    let choiceExpanded = 0;
    let essayExpanded = 0;
    for (const item of course.choices) {
      const before = JSON.stringify(item);
      const options = parseChoiceOptions(item.question);
      const letters = choiceAnswerLetters(item);
      const rendered = analysisModule.enrichChoiceAnalysis({ question: item.question, analysis: item.analysis, letters, options });
      assert(analysisModule.analysisSentences(rendered).length >= 2, `${course.id} choice analysis remains too short: ${item.question.slice(0, 40)}`);
      const compactRendered = rendered.replace(/\s+/g, "");
      for (const letter of letters) assert(compactRendered.includes(options[letter].replace(/\s+/g, "")), `${course.id} choice analysis omits correct option ${letter}.`);
      if (letters.length > 1 && Object.keys(options).some((letter) => !letters.includes(letter))) {
        assert(rendered.includes("未入选项"), `${course.id} multiple-choice analysis omits excluded-option guidance.`);
      }
      assert.equal(JSON.stringify(item), before, `${course.id} choice enrichment mutated source data.`);
      if (rendered !== item.analysis) choiceExpanded += 1;
    }
    for (const item of course.essays) {
      const before = JSON.stringify(item);
      const rendered = analysisModule.enrichEssayAnalysis({ question: item.question, analysis: item.analysis, answer: item.answer });
      assert(analysisModule.analysisSentences(rendered).length >= 4, `${course.id} essay analysis remains too short: ${item.question.slice(0, 40)}`);
      assert.equal(JSON.stringify(item), before, `${course.id} essay enrichment mutated source data.`);
      if (rendered !== item.analysis) essayExpanded += 1;
    }
    summary.push({ course: course.id, choices: course.choices.length, choiceExpanded, essays: course.essays.length, essayExpanded });
  }
  console.table(summary);
  console.log("Rendered analysis quality passed without changing question stems, answers, types, or order.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
