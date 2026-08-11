const assert = require("assert");
const { buildEditorialManifest } = require("./lib/editorial-manifest");
const { loadQuestionBank } = require("./lib/load-question-bank");
const { normalizeText } = require("./lib/editorial-quality");

const SAMPLE_SIZE = { choice: 100, essay: 30 };

function sentences(value) {
  return (String(value || "").match(/[^。！？!?\n]+[。！？!?]?/g) || []).filter((item) => item.trim());
}

function stratifiedSample(entries, size) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.chapter.chapterId || "unclassified";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const queues = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, items]) => items.sort((left, right) => left.order - right.order));
  const sample = [];
  while (sample.length < size && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      if (sample.length >= size) break;
      if (queue.length) sample.push(queue.shift());
    }
  }
  return sample;
}

function effective(entry, field) {
  const revisionField = {
    question: "displayQuestion",
    answer: "displayAnswer",
    analysis: "displayAnalysis",
    correctAnswer: "correctAnswerOverride",
    questionType: "questionTypeOverride"
  }[field];
  return entry.revision?.[revisionField] || entry.payload[field] || "";
}

async function main() {
  const manifest = await buildEditorialManifest();
  const api = loadQuestionBank();
  const summary = [];

  for (const course of api.courses) {
    const published = manifest.entries.filter((entry) => entry.courseId === course.id && entry.quality.publicationStatus === "published");
    const choices = stratifiedSample(published.filter((entry) => entry.questionType === "choice"), SAMPLE_SIZE.choice);
    const essays = stratifiedSample(published.filter((entry) => entry.questionType === "essay"), SAMPLE_SIZE.essay);
    assert.equal(choices.length, SAMPLE_SIZE.choice, `${course.id} lacks ${SAMPLE_SIZE.choice} published choices for sampling.`);
    assert.equal(essays.length, SAMPLE_SIZE.essay, `${course.id} lacks ${SAMPLE_SIZE.essay} published essays for sampling.`);

    for (const entry of [...choices, ...essays]) {
      assert(entry.chapter.chapterId && entry.chapter.status !== "unclassified", `${entry.ref} has no reviewable chapter assignment.`);
      assert(entry.quality.sourceKind && entry.quality.sourceTitle, `${entry.ref} lacks source metadata.`);
      assert(entry.quality.verificationReference, `${entry.ref} lacks a verification reference.`);
    }

    for (const entry of choices) {
      const question = effective(entry, "question");
      const payload = {
        ...entry.payload,
        question,
        answer: effective(entry, "answer"),
        correctAnswer: effective(entry, "correctAnswer"),
        questionType: effective(entry, "questionType")
      };
      const options = api.parseChoiceOptions(question);
      const letters = api.choiceAnswerLetters(payload);
      const analysis = effective(entry, "analysis");
      assert(Object.keys(options).length >= 4, `${entry.ref} has fewer than four options.`);
      assert(letters && [...letters].every((letter) => options[letter]), `${entry.ref} has an invalid answer key.`);
      assert.equal(payload.questionType, letters.length > 1 ? "多选题" : "单选题", `${entry.ref} type does not match its answer key.`);
      assert(sentences(analysis).length >= 2, `${entry.ref} choice analysis has fewer than two sentences.`);
      for (const letter of letters) {
        assert(normalizeText(analysis).includes(normalizeText(options[letter])), `${entry.ref} analysis does not locate correct option ${letter}.`);
      }
    }

    for (const entry of essays) {
      const answer = effective(entry, "answer");
      const analysis = effective(entry, "analysis");
      assert(normalizeText(answer).length >= 35, `${entry.ref} essay standard answer is too short.`);
      assert(entry.revision.scoringPoints.length >= 3 && entry.revision.scoringPoints.length <= 8, `${entry.ref} needs 3-8 scoring points.`);
      assert(entry.revision.keywords.length >= 2, `${entry.ref} needs at least two keywords.`);
      assert(entry.revision.commonMistakes.length >= 1, `${entry.ref} needs a missed-point warning.`);
      assert(sentences(analysis).length >= 4, `${entry.ref} essay analysis has fewer than four sentences.`);
      for (const point of entry.revision.scoringPoints) {
        assert(normalizeText(answer).includes(normalizeText(point)), `${entry.ref} scoring point is not traceable to its standard answer.`);
      }
    }

    summary.push({
      course: course.id,
      choicesAudited: choices.length,
      essaysAudited: essays.length,
      chaptersRepresented: new Set([...choices, ...essays].map((entry) => entry.chapter.chapterId)).size
    });
  }

  console.table(summary);
  console.log("Deterministic editorial sample passed: 100 choices and 30 essays per course.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
