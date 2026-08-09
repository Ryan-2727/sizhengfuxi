const path = require("path");
const { pathToFileURL } = require("url");
const { loadQuestionBank } = require("./load-question-bank");
const {
  characterBigrams,
  jaccard,
  normalizeText,
  normalizedStem,
  payloadHash,
  questionReference,
  sourceMetadata
} = require("./editorial-quality");

const MANUAL_HIDDEN_REVIEW_REASONS = new Map([
  ["mao:essay:24", "cross-course-content-review"],
  ["mao:essay:25", "cross-course-content-review"],
  ["mao:essay:26", "cross-course-content-review"],
  ["mao:essay:27", "cross-course-content-review"],
  ["mao:essay:35", "cross-course-content-review"],
  ["mao:essay:43", "malformed-source-review"],
  ["mao:essay:45", "malformed-source-review"],
  ["mao:essay:46", "malformed-source-review"],
  ["mao:essay:47", "malformed-source-review"],
  ["mao:essay:49", "cross-course-content-review"],
  ["mao:essay:50", "cross-course-content-review"],
  ["mao:essay:51", "cross-course-content-review"],
  ["mao:essay:52", "cross-course-content-review"],
  ["mao:essay:53", "cross-course-content-review"],
  ["mao:essay:54", "cross-course-content-review"],
  ["xi:essay:10", "malformed-source-review"],
  ["marx:essay:38", "malformed-source-review"]
]);

const MANUAL_HIDDEN_DUPLICATE_CANONICALS = new Map([
  ["history:choice:376", "history:choice:936"],
  ["history:choice:660", "history:choice:1038"],
  ["history:choice:836", "history:choice:1102"],
  ["history:choice:850", "history:choice:1110"],
  ["history:choice:871", "history:choice:1126"]
]);

const MANUAL_CHOICE_CORRECTIONS = new Map([
  ["history:choice:1038", {
    answer: "ABCD",
    verificationStatus: "textbook-law-verified",
    sourceKind: "textbook",
    sourceTitle: "《中国近现代史纲要》",
    sourceEdition: "2023年版",
    sourceChapter: "第二章 不同社会力量对国家出路的早期探索",
    sourcePage: "64",
    verificationReference: "《中国近现代史纲要（2023年版）》第64页"
  }],
  ["history:choice:1102", {
    answer: "ABC",
    verificationStatus: "textbook-law-verified",
    sourceKind: "textbook",
    sourceTitle: "《中国近现代史纲要》",
    sourceEdition: "2023年版",
    sourceChapter: "第九章 改革开放与中国特色社会主义的开创和发展",
    sourcePage: "243",
    verificationReference: "《中国近现代史纲要（2023年版）》第243页"
  }],
  ["history:choice:1110", {
    answer: "ABCD",
    verificationStatus: "source-backed",
    sourceKind: "exam-guide",
    sourceTitle: "《中国近现代史纲要考试指南》",
    sourceEdition: null,
    sourceChapter: "社会主义建设在探索中曲折发展",
    sourcePage: "22",
    sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/0/0d/SSID-12130208_%E4%B8%AD%E5%9C%8B%E8%BF%91%E4%BB%A3%E5%8F%B2%E7%B6%B1%E8%A6%81.pdf",
    verificationReference: "《中国近现代史纲要考试指南》第22页"
  }],
  ["history:choice:1126", {
    answer: "ACD",
    verificationStatus: "authoritative-source-verified",
    sourceKind: "authoritative-publication",
    sourceTitle: "《人民日报》：三次巨变和邓小平理论的历史由来",
    sourceEdition: null,
    sourceChapter: null,
    sourcePage: null,
    sourceUrl: "https://cpc.people.com.cn/n/2014/0514/c69113-25015862.html",
    verificationReference: "人民网转载《人民日报》党史理论文章"
  }]
]);

const MANUAL_ESSAY_ANSWER_COMBINATIONS = new Set(["xi:essay:16"]);

const MANUAL_ANSWER_CORRECTIONS = new Map([
  ["mao:essay:31", {
    from: "改革开放和现代化建设的时间是邓小平理论形成的现实依据",
    to: "改革开放和现代化建设的实践是邓小平理论形成的现实依据"
  }]
]);

function sentenceParts(value) {
  return (String(value || "").replace(/\s+(?=\d+[.．、])/g, "\n").match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [])
    .map((part) => part.replace(/^\s*(?:答[:：]|第[一二三四五六七八九十]+[，、.]?|[（(]?\d+[）).、]|[①②③④⑤⑥⑦⑧])\s*/, "").trim())
    .filter((part) => part.length >= 8);
}

function embeddedEssayAnswer(payload) {
  const question = String(payload.question || "").trim();
  const firstPoint = question.search(/\s1[.．、]\s*/);
  if (firstPoint < 4 || firstPoint > 80) return null;
  const answer = question.slice(firstPoint).trim();
  const numberedPoints = answer.match(/(?:^|\s)\d+[.．、]\s*/g) || [];
  if (numberedPoints.length < 2) return null;
  return {
    question: question.slice(0, firstPoint).trim().replace(/[：:]$/, ""),
    answer: answer.replace(/\s+(?=\d+[.．、]\s*)/g, "\n")
  };
}

function scoringPoints(answer) {
  const paragraphs = String(answer || "")
    .split(/\n\s*\n+/)
    .map((part) => part.replace(/^\s*(?:答[:：]|第[一二三四五六七八九十]+[，、.]?|[（(]?\d+[）).、]|[①②③④⑤⑥⑦⑧])\s*/, "").trim())
    .filter((part) => part.length >= 10 && part.length <= 220);
  const clauseFallback = String(answer || "")
    .split(/[，,]/)
    .map((part) => part.replace(/^\s*(?:答[:：]|第[一二三四五六七八九十]+[，、.]?|[（(]?\d+[）).、]|[①②③④⑤⑥⑦⑧])\s*/, "").trim())
    .filter((part) => part.length >= 8);
  const candidates = [...sentenceParts(answer), ...paragraphs, ...clauseFallback];
  const result = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = normalizeText(candidate);
    if (!key || seen.has(key)) continue;
    if (result.some((item) => normalizeText(item).includes(key) || key.includes(normalizeText(item)))) continue;
    seen.add(key);
    result.push(candidate);
    if (result.length === 8) break;
  }
  return result;
}

function shortLabel(value) {
  const text = String(value || "")
    .replace(/^\s*(?:第一|第二|第三|第四|第五|第六|第七|第八)[，、.]?\s*/, "")
    .replace(/[。！？!?；;]/g, "")
    .trim();
  const clause = text.split(/[，,:：]/)[0].trim();
  return (clause || text).slice(0, 14);
}

function essayKeywords(question, answer, chapterTerms, points) {
  const combined = `${question}\n${answer}`;
  const quoted = [...combined.matchAll(/[“《]([^”》]{2,14})[”》]/g)].map((match) => match[1]);
  const matchedTerms = chapterTerms.filter((term) => combined.includes(term));
  const questionTopic = String(question || "")
    .replace(/^(?:结合[^，,。；;：:]{0,30}[，,：:]?)?(?:简述|试述|论述|说明|分析|如何理解|为什么说|为什么|怎样理解|谈谈|请回答)/, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[？?。；;：:]$/g, "")
    .trim();
  const candidates = [...quoted, ...matchedTerms, questionTopic, ...points.map(shortLabel)];
  const result = [];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value.length < 2 || value.length > 14 || result.includes(value)) continue;
    result.push(value);
    if (result.length === 8) break;
  }
  return result;
}

function essayCommonMistakes(analysis, points, keywords) {
  const explicit = sentenceParts(analysis)
    .filter((part) => /不能|不要|避免|遗漏|混淆|失分|易错/.test(part))
    .slice(0, 3);
  if (explicit.length) return explicit;
  if (points.length >= 3) {
    return [`不能只写“${shortLabel(points[0])}”，还应覆盖“${shortLabel(points[1])}”和“${shortLabel(points[2])}”等得分层次。`];
  }
  return [`不要只罗列“${keywords.slice(0, 3).join("、") || "题干关键词"}”，每个要点都应写成完整判断。`];
}

function classifyQuestion(payload, courseId, rules) {
  if (payload.chapterId && ["candidate", "verified"].includes(payload.chapterAssignmentStatus)) {
    return {
      chapterId: payload.chapterId,
      status: payload.chapterAssignmentStatus,
      confidence: payload.chapterAssignmentStatus === "verified" ? 1 : 0.95,
      reference: payload.chapterAssignmentReference || "source-payload"
    };
  }
  const fields = [
    [normalizeText(payload.question), 5],
    [normalizeText(payload.answer), 2],
    [normalizeText(payload.analysis), 1]
  ];
  const matches = (rules[courseId] || []).map(([chapterId, terms]) => {
    let score = 0;
    const matchedTerms = [];
    for (const term of terms) {
      const normalizedTerm = normalizeText(term);
      const looseTerm = normalizedTerm.replace(/[的了]/g, "");
      const termScore = fields.reduce((total, [text, weight]) => {
        const exact = text.includes(normalizedTerm);
        const loose = normalizedTerm.length >= 4 && text.replace(/[的了]/g, "").includes(looseTerm);
        return total + (exact || loose ? weight : 0);
      }, 0);
      if (termScore) matchedTerms.push(term);
      score += termScore;
    }
    return { chapterId, score, matchedTerms };
  }).sort((left, right) => right.score - left.score || right.matchedTerms.length - left.matchedTerms.length);
  const best = matches[0];
  const second = matches[1] || { score: 0 };
  if (!best || best.score < 5 || best.score - second.score < 2) {
    return { chapterId: null, status: "unclassified", confidence: null, reference: null };
  }
  const confidence = Math.min(0.94, 0.55 + (best.score / (best.score + second.score + 4)) * 0.35);
  return {
    chapterId: best.chapterId,
    status: "candidate",
    confidence: Number(confidence.toFixed(2)),
    reference: `weighted-rules-v2:${best.matchedTerms.join("|")}`
  };
}

function expandedRulesForCourse(course, reviewedRules) {
  const existing = new Map((reviewedRules || []).map(([chapterId, terms]) => [chapterId, [...terms]]));
  const generic = new Set(["意义", "作用", "影响", "内容", "关系", "要求", "发展", "理论", "实践", "原则", "道路", "体系", "思想", "建设"]);
  return course.chapters.map((chapter) => {
    const terms = existing.get(chapter.id) || [];
    const candidates = [
      chapter.title.replace(/^(?:导言|绪论|结语|结束语|第[一二三四五六七八九十]+章)\s*/, ""),
      ...chapter.sections.flatMap((section) => [
        section.title,
        ...section.points.flatMap((point) => [point.title, ...(point.keywords || [])])
      ])
    ];
    for (const candidate of candidates) {
      const value = String(candidate || "").trim();
      if (value.length < 2 || value.length > 24 || generic.has(value) || terms.includes(value)) continue;
      terms.push(value);
    }
    return [chapter.id, terms];
  });
}

function correctOptionTexts(item, parseChoiceOptions, choiceAnswerLetters) {
  const options = parseChoiceOptions(item.question);
  const letters = choiceAnswerLetters(item);
  return [...letters].map((letter) => normalizeText(options[letter])).filter(Boolean).sort();
}

function duplicateScore(entry) {
  const verification = {
    "teacher-key-verified": 5,
    "textbook-law-verified": 5,
    "authoritative-source-verified": 5,
    "source-backed": 2,
    pending: 0
  }[entry.quality.verificationStatus] || 0;
  return verification * 10000 + String(entry.payload.analysis || "").length * 10 + String(entry.payload.question || "").length;
}

function equivalentDuplicate(left, right, api) {
  if (left.questionType !== right.questionType) return false;
  if (left.questionType === "choice") {
    const leftOptions = Object.values(api.parseChoiceOptions(left.payload.question)).map(normalizeText).sort();
    const rightOptions = Object.values(api.parseChoiceOptions(right.payload.question)).map(normalizeText).sort();
    return JSON.stringify(leftOptions) === JSON.stringify(rightOptions)
      && JSON.stringify(correctOptionTexts(left.payload, api.parseChoiceOptions, api.choiceAnswerLetters))
        === JSON.stringify(correctOptionTexts(right.payload, api.parseChoiceOptions, api.choiceAnswerLetters));
  }
  const leftAnswer = characterBigrams(left.payload.answer);
  const rightAnswer = characterBigrams(right.payload.answer);
  return jaccard(leftAnswer, rightAnswer) >= 0.92;
}

function exactDuplicateGroups(entries, api) {
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.courseId}:${entry.questionType}:${normalizedStem(entry.payload.question)}`;
    if (!normalizedStem(entry.payload.question)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const result = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((left, right) => duplicateScore(right) - duplicateScore(left));
    const canonical = ordered[0];
    const duplicates = ordered.slice(1).filter((entry) => equivalentDuplicate(canonical, entry, api));
    if (!duplicates.length) continue;
    for (const duplicate of duplicates) {
      duplicate.quality.publicationStatus = "hidden_duplicate";
      duplicate.quality.canonicalRef = canonical.ref;
    }
    result.push({ canonicalRef: canonical.ref, duplicateRefs: duplicates.map((entry) => entry.ref), confidence: "exact-equivalent" });
  }
  return result;
}

function nearDuplicateGroups(entries) {
  const buckets = new Map();
  for (const entry of entries) {
    const key = `${entry.courseId}:${entry.questionType}:${entry.chapter.chapterId || "unclassified"}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entry);
  }
  const result = [];
  for (const bucket of buckets.values()) {
    const prepared = bucket.map((entry) => ({ entry, stem: normalizedStem(entry.payload.question), bigrams: characterBigrams(entry.payload.question) }));
    for (let leftIndex = 0; leftIndex < prepared.length; leftIndex += 1) {
      const left = prepared[leftIndex];
      if (left.stem.length < 12) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < prepared.length; rightIndex += 1) {
        const right = prepared[rightIndex];
        if (left.stem === right.stem || right.stem.length < 12) continue;
        const lengthRatio = Math.min(left.stem.length, right.stem.length) / Math.max(left.stem.length, right.stem.length);
        if (lengthRatio < 0.78) continue;
        const similarity = jaccard(left.bigrams, right.bigrams);
        if (similarity >= 0.88) result.push({ refs: [left.entry.ref, right.entry.ref], similarity: Number(similarity.toFixed(3)) });
      }
    }
  }
  return result;
}

async function buildEditorialManifest() {
  const root = path.resolve(__dirname, "..", "..");
  const analysis = await import(pathToFileURL(path.join(root, "src", "question-analysis.js")).href);
  const rulesModule = await import(pathToFileURL(path.join(root, "src", "question-chapter-rules.js")).href);
  const knowledgeModule = await import(pathToFileURL(path.join(root, "src", "course-knowledge.js")).href);
  const api = loadQuestionBank();
  const knowledge = new Map(knowledgeModule.courseKnowledge.map((course) => [course.id, course]));
  const rules = Object.fromEntries(knowledgeModule.courseKnowledge.map((course) => [
    course.id,
    expandedRulesForCourse(course, rulesModule.reviewedQuestionChapterRules[course.id])
  ]));
  const entries = [];

  for (const course of api.courses) {
    const courseKnowledge = knowledge.get(course.id);
    const chapterTitle = new Map(courseKnowledge.chapters.map((chapter) => [chapter.id, chapter.title]));
    const add = (payload, questionType, order) => {
      const ref = questionReference(course.id, questionType, order);
      const source = sourceMetadata(payload);
      const manualChoiceCorrection = MANUAL_CHOICE_CORRECTIONS.get(ref);
      const chapter = classifyQuestion(payload, course.id, rules);
      const chapterTerms = chapter.chapterId
        ? (rules[course.id].find(([chapterId]) => chapterId === chapter.chapterId)?.[1] || [])
        : [];
      const issues = [];
      let revision;
      if (questionType === "choice") {
        const options = api.parseChoiceOptions(payload.question);
        const extractedLetters = api.choiceAnswerLetters(payload);
        const letters = manualChoiceCorrection?.answer || extractedLetters;
        const expectedType = letters.length > 1 ? "多选题" : "单选题";
        if (!letters || [...letters].some((letter) => !options[letter])) issues.push("invalid-choice-answer");
        if (payload.questionType !== expectedType) issues.push("choice-type-mismatch");
        const enriched = analysis.enrichChoiceAnalysis({ question: payload.question, analysis: payload.analysis, letters, options });
        revision = {
          displayQuestion: null,
          displayAnswer: manualChoiceCorrection ? `正确答案：${letters}` : null,
          displayAnalysis: enriched === payload.analysis ? null : enriched,
          correctAnswerOverride: letters && letters !== payload.correctAnswer ? letters : null,
          questionTypeOverride: payload.questionType === expectedType ? null : expectedType,
          scoringPoints: [],
          keywords: chapterTerms.filter((term) => `${payload.question}\n${payload.analysis}`.includes(term)).slice(0, 8),
          commonMistakes: [],
          revisionNote: manualChoiceCorrection
            ? "选择题人工答案校正：保留原始记录，通过修订层写入教材或权威资料核验后的完整答案，并重建解析。"
            : "选择题结构审校：保留原题与原答案，补充答案定位和记忆提示。",
          verificationReference: manualChoiceCorrection?.verificationReference || source.verificationReference
        };
      } else {
        const recovered = embeddedEssayAnswer(payload);
        const displayQuestion = recovered?.question || payload.question;
        let displayAnswer = recovered?.answer || payload.answer;
        if (recovered) issues.push("answer-recovered-from-question");
        if (recovered && MANUAL_ESSAY_ANSWER_COMBINATIONS.has(ref)) {
          displayAnswer = `${displayAnswer}\n${String(payload.answer || "").trim()}`.trim();
          issues.push("answer-combined-from-source-fields");
        }
        const manualCorrection = MANUAL_ANSWER_CORRECTIONS.get(ref);
        if (manualCorrection) {
          if (!displayAnswer.includes(manualCorrection.from)) {
            throw new Error(`${ref} no longer contains the expected text for its reviewed correction.`);
          }
          displayAnswer = displayAnswer.replace(manualCorrection.from, manualCorrection.to);
          issues.push("manual-text-correction");
        }
        const points = scoringPoints(displayAnswer);
        const keywords = essayKeywords(displayQuestion, displayAnswer, chapterTerms, points);
        const enriched = analysis.enrichEssayAnalysis({ question: displayQuestion, analysis: payload.analysis, answer: displayAnswer, keywords });
        revision = {
          displayQuestion: recovered ? displayQuestion : null,
          displayAnswer,
          displayAnalysis: enriched,
          correctAnswerOverride: null,
          questionTypeOverride: "大题",
          scoringPoints: points,
          keywords,
          commonMistakes: essayCommonMistakes(payload.analysis, points, keywords),
          revisionNote: manualCorrection
            ? "大题人工文本校正：保留原始记录，通过修订层纠正已确认的 OCR 错字，并补充得分点、关键词、常见失分和解题解析。"
            : MANUAL_ESSAY_ANSWER_COMBINATIONS.has(ref)
              ? "大题字段整理：原记录的答案要点分散在题干和答案字段中，修订层合并两部分并补充得分点、关键词、常见失分和解题解析。"
            : "大题结构审校：标准答案沿用原答案，补充得分点、关键词、常见失分和解题解析。",
          verificationReference: source.verificationReference
        };
      }
      const verificationStatus = manualChoiceCorrection?.verificationStatus || source.verificationStatus;
      if (/唯一|首要|根本|核心|最[早先主要]|第一次|标志|会议|法律|《/.test(payload.question)
        && !["teacher-key-verified", "textbook-law-verified", "authoritative-source-verified"].includes(verificationStatus)) {
        issues.push("high-risk-statement-needs-source-review");
      }
      const hiddenReviewReason = MANUAL_HIDDEN_REVIEW_REASONS.get(ref);
      const manualCanonicalRef = MANUAL_HIDDEN_DUPLICATE_CANONICALS.get(ref);
      if (hiddenReviewReason) issues.push(hiddenReviewReason);
      if (manualCanonicalRef) issues.push("reviewed-conflicting-duplicate");
      const reviewStatus = hiddenReviewReason || manualCanonicalRef || issues.includes("high-risk-statement-needs-source-review")
        ? "needs_manual_review"
        : verificationStatus === "pending"
          ? "needs_manual_review"
          : verificationStatus === "source-backed" ? "structural_checked" : "source_verified";
      entries.push({
        ref,
        courseId: course.id,
        questionType,
        order,
        originalPayloadHash: payloadHash(payload),
        payload,
        chapter,
        quality: {
          publicationStatus: hiddenReviewReason ? "hidden_review" : manualCanonicalRef ? "hidden_duplicate" : "published",
          reviewStatus,
          canonicalRef: manualCanonicalRef || null,
          verificationStatus,
          sourceKind: manualChoiceCorrection?.sourceKind || source.sourceKind,
          sourceTitle: manualChoiceCorrection?.sourceTitle || source.sourceTitle,
          sourceEdition: manualChoiceCorrection
            ? manualChoiceCorrection.sourceEdition
            : source.sourceKind === "textbook-review" ? courseKnowledge.edition : null,
          sourceChapter: manualChoiceCorrection
            ? manualChoiceCorrection.sourceChapter
            : chapter.chapterId ? chapterTitle.get(chapter.chapterId) || null : null,
          sourcePage: manualChoiceCorrection?.sourcePage || null,
          sourceUrl: manualChoiceCorrection?.sourceUrl
            || (/^https?:\/\//.test(source.verificationReference || "") ? source.verificationReference : null),
          verificationReference: manualChoiceCorrection?.verificationReference || source.verificationReference
        },
        revision,
        issues
      });
    };
    course.choices.forEach((payload, index) => add(payload, "choice", index + 1));
    course.essays.forEach((payload, index) => add(payload, "essay", index + 1));
  }

  const automaticExactDuplicates = exactDuplicateGroups(
    entries.filter((entry) => entry.quality.publicationStatus === "published"),
    api
  );
  const exactDuplicates = [
    ...[...MANUAL_HIDDEN_DUPLICATE_CANONICALS.entries()].map(([duplicateRef, canonicalRef]) => ({
      canonicalRef,
      duplicateRefs: [duplicateRef],
      confidence: "reviewed-conflicting-source"
    })),
    ...automaticExactDuplicates
  ];
  const nearDuplicates = nearDuplicateGroups(entries.filter((entry) => entry.quality.publicationStatus === "published"));
  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      questions: entries.length,
      choices: entries.filter((entry) => entry.questionType === "choice").length,
      essays: entries.filter((entry) => entry.questionType === "essay").length,
      published: entries.filter((entry) => entry.quality.publicationStatus === "published").length,
      hiddenExactDuplicates: entries.filter((entry) => entry.quality.publicationStatus === "hidden_duplicate").length,
      hiddenForReview: entries.filter((entry) => entry.quality.publicationStatus === "hidden_review").length,
      candidateChapters: entries.filter((entry) => entry.chapter.status === "candidate").length,
      verifiedChapters: entries.filter((entry) => entry.chapter.status === "verified").length,
      unclassifiedChapters: entries.filter((entry) => entry.chapter.status === "unclassified").length,
      sourceReviewQueue: entries.filter((entry) => entry.issues.includes("high-risk-statement-needs-source-review")).length,
      revisions: entries.filter((entry) => entry.revision).length
    },
    exactDuplicates,
    nearDuplicates,
    issueCounts: entries.flatMap((entry) => entry.issues).reduce((counts, issue) => ({ ...counts, [issue]: (counts[issue] || 0) + 1 }), {})
  };
  return { version: 1, report, entries };
}

module.exports = {
  MANUAL_ANSWER_CORRECTIONS,
  MANUAL_CHOICE_CORRECTIONS,
  MANUAL_ESSAY_ANSWER_COMBINATIONS,
  MANUAL_HIDDEN_DUPLICATE_CANONICALS,
  MANUAL_HIDDEN_REVIEW_REASONS,
  buildEditorialManifest,
  classifyQuestion,
  essayCommonMistakes,
  essayKeywords,
  scoringPoints
};
