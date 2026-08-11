const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { loadQuestionBank } = require("./lib/load-question-bank");
const { normalizeText, questionReference } = require("./lib/editorial-quality");

const root = path.resolve(__dirname, "..");
const inputDirectory = path.resolve(process.argv[2] || path.join(root, "tmp", "textbooks"));
const outputPath = path.join(root, "data", "question-editorial-evidence.json");

const TEXTBOOKS = {
  history: {
    book: "《中国近现代史纲要》",
    edition: "2023年版",
    ranges: [["history-intro", 15, 26], ["history-1", 27, 62], ["history-2", 63, 81], ["history-3", 82, 104], ["history-4", 105, 133], ["history-5", 134, 151], ["history-6", 152, 181], ["history-7", 182, 207], ["history-8", 208, 255], ["history-9", 256, 325], ["history-10", 326, 429]]
  },
  morality: {
    book: "《思想道德与法治》",
    edition: "2023年版",
    ranges: [["morality-intro", 9, 20], ["morality-1", 21, 50], ["morality-2", 51, 77], ["morality-3", 78, 114], ["morality-4", 115, 145], ["morality-5", 146, 196], ["morality-6", 197, 264]]
  },
  xi: {
    book: "《习近平新时代中国特色社会主义思想概论》",
    edition: "2023年版",
    ranges: [["xi-1", 14, 34], ["xi-2", 35, 55], ["xi-3", 56, 73], ["xi-4", 74, 90], ["xi-5", 91, 111], ["xi-6", 112, 134], ["xi-7", 135, 156], ["xi-8", 157, 181], ["xi-9", 182, 199], ["xi-10", 200, 223], ["xi-11", 224, 240], ["xi-12", 241, 258], ["xi-13", 259, 276], ["xi-14", 277, 295], ["xi-15", 296, 314], ["xi-16", 315, 336], ["xi-17", 337, 362], ["xi-18", 363, 367]]
  },
  marx: {
    book: "《马克思主义基本原理》",
    edition: "2023年版",
    ranges: [["marx-intro", 10, 32], ["marx-1", 33, 76], ["marx-2", 77, 130], ["marx-3", 131, 189], ["marx-4", 190, 243], ["marx-5", 244, 285], ["marx-6", 286, 330], ["marx-7", 331, 363]]
  }
};

const STOP_GRAMS = new Set(["下列说法", "正确的是", "错误的是", "不正确的", "主要包括", "主要内容", "基本内容", "根本原因", "重要意义", "本质上是", "体现了", "说明了", "标志着"]);

function ngrams(value, size = 4) {
  const text = normalizeText(value);
  const result = new Set();
  for (let index = 0; index <= text.length - size; index += 1) {
    const gram = text.slice(index, index + size);
    if (!STOP_GRAMS.has(gram) && !/^\d+$/.test(gram)) result.add(gram);
  }
  return result;
}

function questionStem(question) {
  const match = String(question || "").match(/^[\s\S]*?(?=(?:^|\n|\s)A(?:[.．、]|\s))/);
  return match ? match[0] : String(question || "");
}

function buildIndex(pages) {
  const normalizedPages = pages.map(normalizeText);
  const index = new Map();
  normalizedPages.forEach((page, pageIndex) => {
    for (const gram of ngrams(page)) {
      if (!index.has(gram)) index.set(gram, []);
      index.get(gram).push(pageIndex);
    }
  });
  return { index, normalizedPages };
}

function rareGrams(value, index, maxPages) {
  return [...ngrams(value)].filter((gram) => {
    const pages = index.get(gram);
    return pages && pages.length <= maxPages;
  });
}

function pageScores(grams, index) {
  const scores = new Map();
  for (const gram of grams) {
    for (const pageIndex of index.get(gram) || []) scores.set(pageIndex, (scores.get(pageIndex) || 0) + 1);
  }
  return scores;
}

function chapterForPage(ranges, pdfPage) {
  return ranges.find(([, start, end]) => pdfPage >= start && pdfPage <= end)?.[0] || null;
}

function bestEvidence(item, type, api, book, indexData) {
  const stemGrams = rareGrams(questionStem(item.question), indexData.index, 18);
  const answerLetters = type === "choice" ? api.choiceAnswerLetters(item) : "";
  const answerText = type === "choice"
    ? [...answerLetters].map((letter) => api.parseChoiceOptions(item.question)[letter]).filter(Boolean).join(" ")
    : item.answer;
  const answerGrams = rareGrams(answerText, indexData.index, 18);
  if (stemGrams.length < 2 || answerGrams.length < 2) return null;
  const stemScores = pageScores(stemGrams, indexData.index);
  const answerScores = pageScores(answerGrams, indexData.index);
  const pages = new Set([...stemScores.keys(), ...answerScores.keys()]);
  let best = null;
  for (const pageIndex of pages) {
    const stemHits = stemScores.get(pageIndex) || 0;
    const answerHits = answerScores.get(pageIndex) || 0;
    const stemCoverage = stemHits / stemGrams.length;
    const answerCoverage = answerHits / answerGrams.length;
    const score = stemCoverage * 0.45 + answerCoverage * 0.55;
    if (!best || score > best.score) best = { pageIndex, stemHits, answerHits, stemCoverage, answerCoverage, score };
  }
  if (!best || best.stemHits < 2 || best.answerHits < 2) return null;
  const threshold = type === "choice" ? 0.48 : 0.42;
  if (best.score < threshold || best.stemCoverage < 0.18 || best.answerCoverage < 0.28) return null;
  const pdfPage = best.pageIndex + 1;
  const chapterId = chapterForPage(book.ranges, pdfPage);
  if (!chapterId) return null;
  const exactSingleAnswer = type === "choice"
    && answerLetters.length === 1
    && normalizeText(answerText).length >= 4
    && indexData.normalizedPages[best.pageIndex].includes(normalizeText(answerText));
  return {
    chapterId,
    chapterAssignmentStatus: "verified",
    chapterConfidence: Number(Math.min(0.99, best.score).toFixed(2)),
    ...(exactSingleAnswer ? { verificationStatus: "textbook-law-verified" } : {}),
    sourceKind: "textbook",
    sourceTitle: book.book,
    sourceEdition: book.edition,
    sourcePage: `PDF第${pdfPage}页`,
    verificationReference: `${book.book}（${book.edition}）PDF第${pdfPage}页：题干核心语义与正确答案同页匹配。`,
    match: {
      stemHits: best.stemHits,
      answerHits: best.answerHits,
      score: Number(best.score.toFixed(3))
    }
  };
}

async function main() {
  const knowledge = await import(pathToFileURL(path.join(root, "src", "course-knowledge.js")).href);
  const chapterIds = new Set(knowledge.courseKnowledge.flatMap((course) => course.chapters.map((chapter) => chapter.id)));
  const api = loadQuestionBank();
  const entries = {};
  const summary = [];
  for (const course of api.courses) {
    const book = TEXTBOOKS[course.id];
    const textPath = path.join(inputDirectory, `${course.id}.txt`);
    if (!book || !fs.existsSync(textPath) || fs.statSync(textPath).size < 1000) continue;
    const pages = fs.readFileSync(textPath, "utf8").split("\f");
    const indexData = buildIndex(pages);
    let matched = 0;
    for (const [type, items] of [["choice", course.choices], ["essay", course.essays]]) {
      items.forEach((item, index) => {
        const evidence = bestEvidence(item, type, api, book, indexData);
        if (!evidence || !chapterIds.has(evidence.chapterId)) return;
        entries[questionReference(course.id, type, index + 1)] = evidence;
        matched += 1;
      });
    }
    summary.push({ course: course.id, matched, total: course.choices.length + course.essays.length });
  }
  const document = {
    version: 1,
    generatedAt: new Date().toISOString(),
    methodology: "Conservative same-page match of rare four-character sequences from the question stem and correct answer against user-provided 2023 textbook PDF text. PDF page numbers are used.",
    entries
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.table(summary);
  console.log(`Textbook evidence: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
