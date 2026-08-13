const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { loadQuestionBank } = require("./load-question-bank");
const {
  characterBigrams,
  jaccard,
  hasHighRiskQuestionClaim,
  normalizeText,
  normalizedStem,
  payloadHash,
  questionReference,
  sourceMetadata
} = require("./editorial-quality");
const { buildQuestionCuration } = require("./question-curation");
const {
  reviewedQuestionChapter,
  reviewedSourceChapter,
  reviewedSourceMetadata
} = require("./editorial-review-overrides");

function loadTextbookEvidence(root) {
  const evidencePath = path.join(root, "data", "question-editorial-evidence.json");
  if (!fs.existsSync(evidencePath)) return new Map();
  const document = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  return new Map(Object.entries(document.entries || {}));
}

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
  ["history:choice:577", "history:choice:1004"],
  ["history:choice:660", "history:choice:1038"],
  ["history:choice:836", "history:choice:1102"],
  ["history:choice:850", "history:choice:1110"],
  ["history:choice:871", "history:choice:1126"]
]);

[
  [721, 1064], [839, 1103], [688, 1051], [672, 1046], [696, 1055],
  [801, 1088], [864, 1121], [829, 1098], [870, 1125], [799, 1086],
  [657, 1036], [669, 1042], [589, 1013], [824, 1096], [820, 1093],
  [638, 1029], [853, 1113], [724, 1065], [762, 1078], [861, 1120],
  [249, 1223], [693, 1053]
].forEach(([duplicateOrder, canonicalOrder]) => {
  MANUAL_HIDDEN_DUPLICATE_CANONICALS.set(`history:choice:${duplicateOrder}`, `history:choice:${canonicalOrder}`);
});

const MANUAL_DISTINCT_NEAR_DUPLICATES = new Set([
  "history:choice:231|history:choice:715",
  "history:choice:43|history:choice:604",
  "history:choice:872|history:choice:1021",
  "xi:choice:79|xi:choice:80"
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

function historyCorrection(answer, chapter, pdfPage = null) {
  const sourcePage = pdfPage ? `PDF第${pdfPage}页` : null;
  return {
    answer,
    verificationStatus: pdfPage ? "textbook-law-verified" : "source-backed",
    sourceKind: pdfPage ? "textbook" : "question-bank-cross-check",
    sourceTitle: pdfPage ? "《中国近现代史纲要》" : "同题多来源答案与2023年版教材框架交叉核对",
    sourceEdition: "2023年版",
    sourceChapter: chapter,
    sourcePage,
    verificationReference: pdfPage
      ? `《中国近现代史纲要》（2023年版）PDF第${pdfPage}页及同题多来源答案交叉核对。`
      : "同题多来源答案、题干限定词和2023年版教材章节表述交叉核对；待补教材精确页码。"
  };
}

[
  [1064, "ABCD", "第五章 中国革命的新道路", 144],
  [1103, "AB", "第九章 改革开放与中国特色社会主义的开创和发展"],
  [1051, "BC", "第五章 中国革命的新道路", 142],
  [715, "ABD", "第五章 中国革命的新道路"],
  [1046, "BD", "第五章 中国革命的新道路"],
  [1055, "ABC", "第五章 中国革命的新道路", 145],
  [1088, "AC", "第八章 中华人民共和国的成立与中国社会主义建设道路的探索"],
  [1121, "ABC", "第九章 改革开放与中国特色社会主义的开创和发展"],
  [1098, "CD", "第八章 中华人民共和国的成立与中国社会主义建设道路的探索", 236],
  [1021, "ABD", "第一章 进入近代后中华民族的磨难与抗争"],
  [1125, "ABCD", "第九章 改革开放与中国特色社会主义的开创和发展"],
  [1086, "AB", "第八章 中华人民共和国的成立与中国社会主义建设道路的探索"],
  [1036, "ABCD", "第二章 不同社会力量对国家出路的早期探索"],
  [1042, "ACD", "第六章 中华民族的抗日战争"],
  [604, "AC", "第一章 进入近代后中华民族的磨难与抗争"],
  [1013, "ABCD", "导言"],
  [1096, "ABCD", "第八章 中华人民共和国的成立与中国社会主义建设道路的探索"],
  [1093, "ABCD", "第八章 中华人民共和国的成立与中国社会主义建设道路的探索", 250],
  [1029, "ACD", "第一章 进入近代后中华民族的磨难与抗争", 47],
  [1113, "CD", "第九章 改革开放与中国特色社会主义的开创和发展"],
  [1065, "BCD", "第五章 中国革命的新道路", 135],
  [1078, "ABC", "第八章 中华人民共和国的成立与中国社会主义建设道路的探索"],
  [1120, "ABCD", "第九章 改革开放与中国特色社会主义的开创和发展"],
  [1053, "BD", "第六章 中华民族的抗日战争"]
].forEach(([order, answer, chapter, pdfPage]) => {
  MANUAL_CHOICE_CORRECTIONS.set(`history:choice:${order}`, historyCorrection(answer, chapter, pdfPage));
});

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

function questionStemText(question) {
  const text = String(question || "");
  const firstOption = text.search(/(?:^|\n|\s)A(?:[.．、]\s*|\s+|(?=[\u4e00-\u9fff]))/);
  return firstOption >= 0 ? text.slice(0, firstOption) : text;
}

function cleanChoiceQuestion(question) {
  const text = String(question || "");
  const firstOption = text.search(/(?:^|\n|\s)A(?:[.．、]\s*|\s+|(?=[\u4e00-\u9fff]))/);
  if (firstOption < 0) return text;
  const stem = text.slice(0, firstOption);
  const cleanedStem = cleanChoiceSourceMarker(stem);
  return cleanedStem === stem ? text : `${cleanedStem}\n${text.slice(firstOption).trimStart()}`;
}

function cleanChoiceSourceMarker(value) {
  return String(value || "").replace(
    /([（(]\s*[）)])([。！？!?；;，,：:]*)\s*(?:正确|错误|正|误)(?=\s*(?:[”"'’]|[。！？!?；;\n]|$))/gu,
    "$1$2"
  );
}

function answerLeakedInChoiceStem(question, options, letters) {
  const stem = questionStemText(question);
  const parenthetical = [...stem.matchAll(/[（(]([^（）()]{2,100})[）)]/g)]
    .map((match) => normalizeText(match[1]))
    .filter(Boolean);
  if (!parenthetical.length) return false;
  return [...letters].some((letter) => {
    const answer = normalizeText(options[letter]);
    if (answer.length < 4) return false;
    return parenthetical.some((content) => content.includes(answer)
      || (content.length >= 4 && answer.includes(content)));
  });
}

function classifyQuestion(payload, courseId, rules, reviewedAssignment = null, answerText = "") {
  if (payload.chapterId && ["candidate", "verified"].includes(payload.chapterAssignmentStatus)) {
    return {
      chapterId: payload.chapterId,
      status: payload.chapterAssignmentStatus,
      confidence: payload.chapterAssignmentStatus === "verified" ? 1 : 0.95,
      reference: payload.chapterAssignmentReference || "source-payload"
    };
  }
  if (reviewedAssignment?.chapterId) return reviewedAssignment;
  const stem = normalizeText(questionStemText(payload.question));
  const fields = [
    [stem, 8],
    [normalizeText(answerText || payload.answer), 4],
    [normalizeText(payload.analysis), 2]
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
  if (best && best.score >= 6 && best.score - second.score >= 2) {
    const confidence = Math.min(0.94, 0.55 + (best.score / (best.score + second.score + 4)) * 0.35);
    return {
      chapterId: best.chapterId,
      status: "candidate",
      confidence: Number(confidence.toFixed(2)),
      reference: `weighted-rules-v3:${best.matchedTerms.join("|")}`
    };
  }

  const semanticText = characterBigrams(`${questionStemText(payload.question)} ${payload.analysis || ""}`);
  const semanticMatches = (rules[courseId] || []).map(([chapterId, terms]) => {
    let score = 0;
    const matchedTerms = [];
    for (const term of terms) {
      const normalizedTerm = normalizeText(term);
      if (normalizedTerm.length < 3) continue;
      const termBigrams = characterBigrams(normalizedTerm);
      const overlap = jaccard(semanticText, termBigrams);
      if (overlap < 0.035) continue;
      score += overlap * Math.min(10, normalizedTerm.length);
      matchedTerms.push(term);
    }
    return { chapterId, score, matchedTerms };
  }).sort((left, right) => right.score - left.score);
  const semanticBest = semanticMatches[0];
  const semanticSecond = semanticMatches[1] || { score: 0 };
  if (!semanticBest || semanticBest.score < 0.01) {
    return { chapterId: null, status: "unclassified", confidence: null, reference: null };
  }
  const confidence = Math.min(0.78, 0.5 + (semanticBest.score / (semanticBest.score + semanticSecond.score + 2)) * 0.28);
  return {
    chapterId: semanticBest.chapterId,
    status: "candidate",
    confidence: Number(confidence.toFixed(2)),
    reference: `semantic-rules-v1:${semanticBest.matchedTerms.slice(0, 6).join("|")}`
  };
}

function resolveQuestionChapter(payload, courseId, rules, evidence, reviewedChapterAssignment, answerText) {
  if (payload.chapterId && payload.chapterAssignmentStatus === "verified") {
    return {
      chapter: classifyQuestion(payload, courseId, rules, null, answerText),
      evidenceConflict: false
    };
  }
  if (reviewedChapterAssignment?.chapterId) {
    const { supersedesEvidence, ...chapterAssignment } = reviewedChapterAssignment;
    return {
      chapter: classifyQuestion(payload, courseId, rules, chapterAssignment, answerText),
      evidenceConflict: !supersedesEvidence
        && Boolean(evidence?.chapterId && evidence.chapterId !== reviewedChapterAssignment.chapterId)
    };
  }

  const rulePayload = { ...payload };
  delete rulePayload.chapterId;
  delete rulePayload.chapterAssignmentStatus;
  delete rulePayload.chapterAssignmentReference;
  const ruleCandidate = classifyQuestion(rulePayload, courseId, rules, null, answerText);
  if (!evidence?.chapterId) return { chapter: ruleCandidate, evidenceConflict: false };
  if (ruleCandidate.chapterId === evidence.chapterId && ruleCandidate.status !== "unclassified") {
    return {
      chapter: {
        chapterId: evidence.chapterId,
        status: "verified",
        confidence: Number(Math.min(Number(evidence.chapterConfidence || 1), Number(ruleCandidate.confidence || 1)).toFixed(2)),
        reference: `${evidence.verificationReference}; independent-chapter-match:${ruleCandidate.reference}`
      },
      evidenceConflict: false
    };
  }
  if (ruleCandidate.chapterId) {
    return {
      chapter: {
        ...ruleCandidate,
        status: "candidate",
        reference: `${ruleCandidate.reference}; textbook-page-candidate:${evidence.chapterId}`
      },
      evidenceConflict: true
    };
  }
  return {
    chapter: {
      chapterId: evidence.chapterId,
      status: "candidate",
      confidence: Number(Math.min(0.74, Number(evidence.chapterConfidence || 0.5)).toFixed(2)),
      reference: `textbook-page-candidate:${evidence.verificationReference}`
    },
    evidenceConflict: false
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

function resolveEquivalentNearDuplicates(entries, api) {
  const candidates = nearDuplicateGroups(entries.filter((entry) => entry.quality.publicationStatus === "published"));
  const byRef = new Map(entries.map((entry) => [entry.ref, entry]));
  const resolved = [];
  const unresolved = [];
  for (const candidate of candidates.sort((left, right) => right.similarity - left.similarity)) {
    const reviewedPairKey = candidate.refs.join("|");
    if (MANUAL_DISTINCT_NEAR_DUPLICATES.has(reviewedPairKey)) continue;
    const pair = candidate.refs.map((ref) => byRef.get(ref));
    if (pair.some((entry) => !entry || entry.quality.publicationStatus !== "published")) continue;
    if (!equivalentDuplicate(pair[0], pair[1], api)) {
      unresolved.push(candidate);
      continue;
    }
    const [canonical, duplicate] = [...pair].sort((left, right) => duplicateScore(right) - duplicateScore(left));
    duplicate.quality.publicationStatus = "hidden_duplicate";
    duplicate.quality.canonicalRef = canonical.ref;
    duplicate.quality.reviewStatus = "structural_checked";
    duplicate.issues.push("semantic-equivalent-duplicate");
    resolved.push({
      canonicalRef: canonical.ref,
      duplicateRefs: [duplicate.ref],
      confidence: `semantic-equivalent:${candidate.similarity}`
    });
  }
  return { resolved, unresolved };
}

async function buildEditorialManifest() {
  const root = path.resolve(__dirname, "..", "..");
  const analysis = await import(pathToFileURL(path.join(root, "src", "question-analysis.js")).href);
  const rulesModule = await import(pathToFileURL(path.join(root, "src", "question-chapter-rules.js")).href);
  const knowledgeModule = await import(pathToFileURL(path.join(root, "src", "course-knowledge.js")).href);
  const api = loadQuestionBank();
  const textbookEvidence = loadTextbookEvidence(root);
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
      const reviewedSource = reviewedSourceMetadata(course.id, payload);
      const evidence = textbookEvidence.get(ref) || null;
      const manualChoiceCorrection = MANUAL_CHOICE_CORRECTIONS.get(ref);
      const answerText = questionType === "choice"
        ? [...api.choiceAnswerLetters(payload)].map((letter) => api.parseChoiceOptions(payload.question)[letter]).filter(Boolean).join(" ")
        : payload.answer;
      const reviewedChapterAssignment = reviewedQuestionChapter(ref) || reviewedSourceChapter(course.id, payload);
      const chapterResolution = resolveQuestionChapter(
        payload,
        course.id,
        rules,
        evidence,
        reviewedChapterAssignment,
        answerText
      );
      const chapter = chapterResolution.chapter;
      const chapterTerms = chapter.chapterId
        ? (rules[course.id].find(([chapterId]) => chapterId === chapter.chapterId)?.[1] || [])
        : [];
      const issues = [];
      if (chapterResolution.evidenceConflict) issues.push("chapter-evidence-conflict");
      let revision;
      if (questionType === "choice") {
        const displayQuestion = cleanChoiceQuestion(payload.question);
        const options = api.parseChoiceOptions(displayQuestion);
        const extractedLetters = api.choiceAnswerLetters(payload);
        const letters = manualChoiceCorrection?.answer || extractedLetters;
        const expectedType = letters.length > 1 ? "多选题" : "单选题";
        if (!letters || [...letters].some((letter) => !options[letter])) issues.push("invalid-choice-answer");
        if (payload.questionType !== expectedType && !manualChoiceCorrection) issues.push("choice-type-mismatch");
        if (answerLeakedInChoiceStem(payload.question, options, letters)) issues.push("answer-leaked-in-stem");
        const enriched = analysis.enrichChoiceAnalysis({
          question: displayQuestion,
          analysis: cleanChoiceSourceMarker(payload.analysis),
          letters,
          options
        });
        revision = {
          displayQuestion: displayQuestion === payload.question ? null : displayQuestion,
          displayAnswer: manualChoiceCorrection ? `正确答案：${letters}` : null,
          displayAnalysis: enriched === payload.analysis ? null : enriched,
          correctAnswerOverride: letters && letters !== payload.correctAnswer ? letters : null,
          questionTypeOverride: payload.questionType === expectedType ? null : expectedType,
          scoringPoints: [],
          keywords: chapterTerms.filter((term) => `${payload.question}\n${payload.analysis}`.includes(term)).slice(0, 8),
          commonMistakes: [],
          revisionNote: manualChoiceCorrection
            ? "选择题人工答案校正：保留原始记录，通过修订层写入教材或权威资料核验后的完整答案，并重建解析。"
            : displayQuestion !== payload.question
              ? "选择题格式审校：保留原始记录，通过修订层移除题干末尾泄露答案判断的来源标记，并补充答案定位和记忆提示。"
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
        const sourceAnalysis = recovered ? "" : payload.analysis;
        const points = scoringPoints(displayAnswer);
        const keywords = essayKeywords(displayQuestion, displayAnswer, chapterTerms, points);
        const enriched = analysis.enrichEssayAnalysis({ question: displayQuestion, analysis: sourceAnalysis, answer: displayAnswer, keywords });
        revision = {
          displayQuestion: recovered ? displayQuestion : null,
          displayAnswer,
          displayAnalysis: enriched,
          correctAnswerOverride: null,
          questionTypeOverride: "大题",
          scoringPoints: points,
          keywords,
          commonMistakes: essayCommonMistakes(sourceAnalysis, points, keywords),
          revisionNote: manualCorrection
            ? "大题人工文本校正：保留原始记录，通过修订层纠正已确认的 OCR 错字，并补充得分点、关键词、常见失分和解题解析。"
            : MANUAL_ESSAY_ANSWER_COMBINATIONS.has(ref)
              ? "大题字段整理：原记录的答案要点分散在题干和答案字段中，修订层合并两部分并补充得分点、关键词、常见失分和解题解析。"
            : "大题结构审校：标准答案沿用原答案，补充得分点、关键词、常见失分和解题解析。",
          verificationReference: source.verificationReference
        };
      }
      const verificationStatus = manualChoiceCorrection?.verificationStatus
        || evidence?.verificationStatus
        || reviewedSource?.verificationStatus
        || source.verificationStatus;
      const verificationReference = manualChoiceCorrection?.verificationReference
        || evidence?.verificationReference
        || reviewedSource?.verificationReference
        || source.verificationReference
        || (source.sourceTitle ? `来源记录：${source.sourceTitle}` : null);
      if (hasHighRiskQuestionClaim(payload.question)
        && !["teacher-key-verified", "textbook-law-verified", "authoritative-source-verified"].includes(verificationStatus)) {
        issues.push("high-risk-statement-needs-source-review");
      }
      const manualCanonicalRef = MANUAL_HIDDEN_DUPLICATE_CANONICALS.get(ref);
      const hiddenReviewReason = MANUAL_HIDDEN_REVIEW_REASONS.get(ref)
        || (!manualCanonicalRef && issues.includes("high-risk-statement-needs-source-review") ? "source-verification-required" : null)
        || (!manualCanonicalRef && issues.includes("answer-leaked-in-stem") ? "answer-leaked-in-stem" : null)
        || (!manualCanonicalRef && chapter.status === "unclassified" ? "chapter-classification-required" : null);
      if (hiddenReviewReason) issues.push(hiddenReviewReason);
      if (manualCanonicalRef) issues.push("reviewed-conflicting-duplicate");
      const reviewStatus = hiddenReviewReason || manualCanonicalRef
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
          sourceKind: manualChoiceCorrection?.sourceKind || evidence?.sourceKind || reviewedSource?.sourceKind || source.sourceKind,
          sourceTitle: manualChoiceCorrection?.sourceTitle || evidence?.sourceTitle || source.sourceTitle,
          sourceEdition: manualChoiceCorrection
            ? manualChoiceCorrection.sourceEdition
            : evidence?.sourceEdition || (source.sourceKind === "textbook-review" ? courseKnowledge.edition : null),
          sourceChapter: manualChoiceCorrection
            ? manualChoiceCorrection.sourceChapter
            : evidence?.chapterId
              ? chapterTitle.get(evidence.chapterId) || null
              : chapter.chapterId ? chapterTitle.get(chapter.chapterId) || null : null,
          sourcePage: manualChoiceCorrection?.sourcePage || evidence?.sourcePage || null,
          sourceUrl: manualChoiceCorrection?.sourceUrl
            || (/^https?:\/\//.test(source.verificationReference || "") ? source.verificationReference : null),
          verificationReference
        },
        revision,
        issues
      });
    };
    course.choices.forEach((payload, index) => add(payload, "choice", index + 1));
    course.essays.forEach((payload, index) => add(payload, "essay", index + 1));
  }

  const entriesByRef = new Map(entries.map((entry) => [entry.ref, entry]));
  for (const [duplicateRef, canonicalRef] of MANUAL_HIDDEN_DUPLICATE_CANONICALS) {
    const duplicate = entriesByRef.get(duplicateRef);
    const canonical = entriesByRef.get(canonicalRef);
    if (!duplicate || !canonical) throw new Error(`Reviewed duplicate link is incomplete: ${duplicateRef} -> ${canonicalRef}.`);
    if (canonical.quality.publicationStatus === "published") continue;
    duplicate.quality.publicationStatus = "hidden_review";
    duplicate.quality.reviewStatus = "needs_manual_review";
    duplicate.quality.canonicalRef = null;
    duplicate.issues.push("canonical-under-review");
  }

  const automaticExactDuplicates = exactDuplicateGroups(
    entries.filter((entry) => entry.quality.publicationStatus === "published"),
    api
  );
  const semanticDuplicates = resolveEquivalentNearDuplicates(entries, api);
  const exactDuplicates = [
    ...[...MANUAL_HIDDEN_DUPLICATE_CANONICALS.entries()]
      .filter(([duplicateRef]) => entriesByRef.get(duplicateRef)?.quality.publicationStatus === "hidden_duplicate")
      .map(([duplicateRef, canonicalRef]) => ({
        canonicalRef,
        duplicateRefs: [duplicateRef],
        confidence: "reviewed-conflicting-source"
      })),
    ...automaticExactDuplicates,
    ...semanticDuplicates.resolved
  ];
  const nearDuplicates = semanticDuplicates.unresolved;
  const curation = buildQuestionCuration(entries, api, knowledgeModule.courseKnowledge);
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
      unclassifiedChapters: entries.filter((entry) => entry.chapter.status === "unclassified" && entry.quality.publicationStatus === "published").length,
      archivedUnclassifiedChapters: entries.filter((entry) => entry.chapter.status === "unclassified" && entry.quality.publicationStatus === "hidden_review").length,
      sourceReviewQueue: entries.filter((entry) => entry.issues.includes("high-risk-statement-needs-source-review") && entry.quality.publicationStatus === "published").length,
      archivedSourceReview: entries.filter((entry) => entry.issues.includes("high-risk-statement-needs-source-review") && entry.quality.publicationStatus === "hidden_review").length,
      revisions: entries.filter((entry) => entry.revision).length,
      curatedChoices: curation.report.totals.choices,
      curatedEssays: curation.report.totals.essays,
      curatedCompleteChapters: curation.report.totals.completeChapters,
      curatedChaptersWithGaps: curation.report.totals.chaptersWithGaps
    },
    exactDuplicates,
    nearDuplicates,
    issueCounts: entries.flatMap((entry) => entry.issues).reduce((counts, issue) => ({ ...counts, [issue]: (counts[issue] || 0) + 1 }), {})
  };
  return {
    version: 1,
    report,
    entries,
    curation: curation.manifest,
    curationReport: curation.report
  };
}

module.exports = {
  MANUAL_ANSWER_CORRECTIONS,
  MANUAL_CHOICE_CORRECTIONS,
  MANUAL_ESSAY_ANSWER_COMBINATIONS,
  MANUAL_DISTINCT_NEAR_DUPLICATES,
  MANUAL_HIDDEN_DUPLICATE_CANONICALS,
  MANUAL_HIDDEN_REVIEW_REASONS,
  answerLeakedInChoiceStem,
  buildEditorialManifest,
  cleanChoiceQuestion,
  cleanChoiceSourceMarker,
  classifyQuestion,
  resolveQuestionChapter,
  essayCommonMistakes,
  essayKeywords,
  scoringPoints
};
