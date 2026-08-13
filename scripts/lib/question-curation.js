const {
  characterBigrams,
  jaccard,
  normalizeText,
  normalizedStem
} = require("./editorial-quality");

const CURATION_VERSION = "2026-08-13-v2";
const CURATION_TARGETS = Object.freeze({ choice: 10, essay: 2 });
const STRONG_VERIFICATION_STATUSES = new Set([
  "teacher-key-verified",
  "textbook-law-verified",
  "authoritative-source-verified"
]);
const BLOCKING_ISSUES = new Set([
  "answer-combined-from-source-fields",
  "answer-leaked-in-stem",
  "answer-recovered-from-question",
  "chapter-classification-required",
  "chapter-evidence-conflict",
  "choice-type-mismatch",
  "cross-course-content-review",
  "high-risk-statement-needs-source-review",
  "invalid-choice-answer",
  "malformed-source-review",
  "reviewed-conflicting-duplicate",
  "semantic-equivalent-duplicate",
  "source-verification-required"
]);
const TEMPLATE_SOURCE_PATTERN = /2023版教材结构化知识点校审|精选补充题/;

function sentenceParts(value) {
  return String(value || "")
    .split(/[\u3002\uff01\uff1f!?\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function effectiveValue(entry, field) {
  const revisionKey = {
    question: "displayQuestion",
    answer: "displayAnswer",
    analysis: "displayAnalysis"
  }[field];
  return entry.revision?.[revisionKey] || entry.payload?.[field] || "";
}

function baseEligibility(entry) {
  const reasons = [];
  if (entry.quality.publicationStatus !== "published") reasons.push("not-published");
  if (!entry.chapter.chapterId || entry.chapter.status !== "verified") reasons.push("chapter-not-verified");
  if (entry.quality.reviewStatus !== "source_verified") reasons.push("source-not-verified");
  if (!STRONG_VERIFICATION_STATUSES.has(entry.quality.verificationStatus)) reasons.push("verification-not-strong");
  if (TEMPLATE_SOURCE_PATTERN.test(String(entry.payload.source || ""))) reasons.push("template-generated-source");
  for (const issue of entry.issues) if (BLOCKING_ISSUES.has(issue)) reasons.push(issue);
  return [...new Set(reasons)];
}

function choiceEligibility(entry, api) {
  const reasons = baseEligibility(entry);
  const question = effectiveValue(entry, "question");
  const analysis = effectiveValue(entry, "analysis");
  const sourceAnalysis = String(entry.payload.analysis || "");
  const options = api.parseChoiceOptions(question);
  const letters = entry.revision?.correctAnswerOverride || api.choiceAnswerLetters(entry.payload);
  const expectedType = letters.length > 1 ? "多选题" : "单选题";
  const effectiveType = entry.revision?.questionTypeOverride || entry.payload.questionType;
  if (!letters || [...letters].some((letter) => !options[letter])) reasons.push("invalid-effective-answer");
  if (effectiveType !== expectedType) reasons.push("invalid-effective-type");
  if (sentenceParts(analysis).length < 3) reasons.push("analysis-too-short");
  if (normalizeText(sourceAnalysis).length < 12) reasons.push("source-analysis-too-short");
  if ([...letters].some((letter) => !normalizeText(analysis).includes(normalizeText(options[letter])))) {
    reasons.push("analysis-misses-correct-option");
  }
  if (!/因为|由于|因此|所以|表明|体现|说明|依据|对应|区别|排除|混淆|限定|关键|属于|不属于|不能|分别|发生|形成|提出|确立|完成|标志/.test(analysis)) {
    reasons.push("analysis-lacks-question-reasoning");
  }
  if (letters.length > 1 && !/多选|未入选项|逐项|共同|包括|均为|属于/.test(analysis)) {
    reasons.push("multiple-choice-guidance-missing");
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    metrics: {
      analysisLength: normalizeText(analysis).length,
      sourceAnalysisLength: normalizeText(sourceAnalysis).length,
      sentenceCount: sentenceParts(analysis).length
    }
  };
}

function essayEligibility(entry) {
  const reasons = baseEligibility(entry);
  const answer = effectiveValue(entry, "answer");
  const analysis = effectiveValue(entry, "analysis");
  const sourceAnalysis = String(entry.payload.analysis || "");
  const points = entry.revision?.scoringPoints || [];
  const keywords = entry.revision?.keywords || [];
  const mistakes = entry.revision?.commonMistakes || [];
  if (normalizeText(answer).length < 80) reasons.push("answer-too-short");
  if (points.length < 3) reasons.push("scoring-points-incomplete");
  if (keywords.length < 2) reasons.push("keywords-incomplete");
  if (mistakes.length < 1) reasons.push("common-mistake-missing");
  if (sentenceParts(analysis).length < 4) reasons.push("analysis-too-short");
  if (normalizeText(sourceAnalysis).length < 30) reasons.push("source-analysis-too-short");
  if (points.some((point) => !normalizeText(answer).includes(normalizeText(point)))) {
    reasons.push("scoring-point-not-traceable");
  }
  if (!/定位|作答|答案|得分|先|再|最后|材料|设问|结构|层次|角度|记忆|失分|不要|避免/.test(analysis)) {
    reasons.push("analysis-lacks-answer-method");
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    metrics: {
      answerLength: normalizeText(answer).length,
      analysisLength: normalizeText(analysis).length,
      sourceAnalysisLength: normalizeText(sourceAnalysis).length,
      sentenceCount: sentenceParts(analysis).length,
      scoringPointCount: points.length,
      keywordCount: keywords.length
    }
  };
}

function questionEligibility(entry, api) {
  return entry.questionType === "choice" ? choiceEligibility(entry, api) : essayEligibility(entry);
}

function curationScore(entry, result) {
  const verificationScore = {
    "teacher-key-verified": 4000,
    "authoritative-source-verified": 3600,
    "textbook-law-verified": 3400
  }[entry.quality.verificationStatus] || 0;
  const pageScore = entry.quality.sourcePage ? 500 : 0;
  const chapterScore = Math.round(Number(entry.chapter.confidence || 0) * 500);
  const analysisScore = Math.min(700, result.metrics.analysisLength || 0);
  const answerScore = Math.min(500, result.metrics.answerLength || 0);
  const scoringPointScore = (result.metrics.scoringPointCount || 0) * 40;
  return verificationScore + pageScore + chapterScore + analysisScore + answerScore + scoringPointScore;
}

function tooSimilar(left, right) {
  const leftStem = normalizedStem(effectiveValue(left, "question"));
  const rightStem = normalizedStem(effectiveValue(right, "question"));
  if (!leftStem || !rightStem) return false;
  if (leftStem === rightStem) return true;
  const lengthRatio = Math.min(leftStem.length, rightStem.length) / Math.max(leftStem.length, rightStem.length);
  return lengthRatio >= 0.78 && jaccard(characterBigrams(leftStem), characterBigrams(rightStem)) >= 0.84;
}

function curationReason(entry) {
  if (entry.quality.verificationStatus === "teacher-key-verified") {
    return "教师答案与章节来源明确，答案和解析达到章节精选门槛。";
  }
  if (entry.quality.verificationStatus === "authoritative-source-verified") {
    return "权威题源与章节定位已核对，答案和解析达到章节精选门槛。";
  }
  return entry.quality.sourcePage
    ? "教材页码与章节定位已核对，答案和解析达到章节精选门槛。"
    : "教材依据与章节定位已核对，答案和解析达到章节精选门槛。";
}

function shortFocus(question) {
  return String(question || "")
    .split(/(?:^|\n|\s)A(?:[.．、]\s*|\s+)/)[0]
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/[？?。；;：:，,\s]/g, "")
    .slice(0, 24) || "题干限定";
}

function appendUniqueAnalysis(base, additions) {
  const result = sentenceParts(base);
  const compact = normalizeText(result.join(""));
  for (const addition of additions) {
    const label = addition.split("：")[0];
    if (compact.includes(normalizeText(label))) continue;
    result.push(addition);
  }
  return result.map((part) => /[。！？!?；;]$/.test(part) ? part : `${part}。`).join("\n");
}

function deepenCuratedAnalysis(entry, api) {
  const question = effectiveValue(entry, "question");
  const focus = shortFocus(question);
  const current = effectiveValue(entry, "analysis");
  if (entry.questionType === "choice") {
    const options = api.parseChoiceOptions(question);
    const letters = entry.revision.correctAnswerOverride || api.choiceAnswerLetters(entry.payload);
    const correctOptions = [...letters]
      .map((letter) => options[letter] ? `${letter}.${options[letter]}` : letter)
      .join("；");
    entry.revision.displayAnalysis = appendUniqueAnalysis(current, [
      `解题步骤：先锁定题干中的“${focus}”，再逐项核对选项与这一限定是否直接对应，最后确认答案为${letters}`,
      `排除提示：未入选项不能同时满足本题限定，不能因为某个表述在其他语境中成立就脱离题干范围选入`,
      `记忆提示：把“${focus}”与“${correctOptions}”建立对应，再回到所属章节复述判断依据`
    ]);
    entry.revision.revisionNote = "章节精选解析审校：保留原解析，补充仅由题干、选项与标准答案推导的审题步骤、排除提示和记忆方法。";
    return;
  }
  const pointLabels = (entry.revision.scoringPoints || []).slice(0, 5)
    .map((point) => String(point).replace(/[。！？!?；;]/g, "").slice(0, 18));
  const keywords = (entry.revision.keywords || []).slice(0, 5);
  entry.revision.displayAnalysis = appendUniqueAnalysis(current, [
    `得分点核对：按“${pointLabels.join("—")}”的顺序检查标准答案，每个层次都写成完整判断`,
    keywords.length
      ? `材料对应：材料出现“${keywords.join("、")}”时，先判断其对应本题哪一得分点，再引用材料事实展开`
      : "材料对应：先把材料信息对应到标准答案的具体得分点，再按题干设问组织表述",
    `背诵提示：先记“${pointLabels.slice(0, 4).join("—")}”骨架，再补充各点中的对象、关系和结论`
  ]);
  entry.revision.revisionNote = "章节精选解析审校：标准答案保持不变，依据既有得分点和关键词补充核对顺序、材料对应和背诵方法。";
}

function selectCandidates(candidates, target) {
  const selected = [];
  for (const candidate of candidates.sort((left, right) => right.score - left.score || left.entry.order - right.entry.order)) {
    if (selected.some((current) => tooSimilar(current.entry, candidate.entry))) continue;
    selected.push(candidate);
    if (selected.length === target) break;
  }
  return selected;
}

function buildQuestionCuration(entries, api, knowledgeCourses) {
  for (const entry of entries) {
    entry.quality.curationStatus = "standard";
    entry.quality.curationRank = null;
    entry.quality.curationReason = null;
    entry.quality.curationVersion = CURATION_VERSION;
  }

  const eligibilityByRef = new Map();
  const candidatesByKey = new Map();
  for (const entry of entries) {
    const eligibility = questionEligibility(entry, api);
    eligibilityByRef.set(entry.ref, eligibility);
    if (!eligibility.eligible) continue;
    const key = `${entry.courseId}:${entry.chapter.chapterId}:${entry.questionType}`;
    if (!candidatesByKey.has(key)) candidatesByKey.set(key, []);
    candidatesByKey.get(key).push({ entry, eligibility, score: curationScore(entry, eligibility) });
  }

  const selectedEntries = [];
  const chapters = [];
  for (const course of knowledgeCourses) {
    for (const chapter of course.chapters) {
      const chapterReport = {
        courseId: course.id,
        courseTitle: course.book,
        chapterId: chapter.id,
        chapterTitle: chapter.title
      };
      for (const type of ["choice", "essay"]) {
        const candidates = candidatesByKey.get(`${course.id}:${chapter.id}:${type}`) || [];
        const selected = selectCandidates(candidates, CURATION_TARGETS[type]);
        selected.forEach(({ entry }, index) => {
          entry.quality.curationStatus = "chapter_core";
          entry.quality.curationRank = index + 1;
          entry.quality.curationReason = curationReason(entry);
          deepenCuratedAnalysis(entry, api);
          selectedEntries.push(entry);
        });
        chapterReport[`${type}Eligible`] = candidates.length;
        chapterReport[`${type}Selected`] = selected.length;
        chapterReport[`${type}Gap`] = Math.max(0, CURATION_TARGETS[type] - selected.length);
      }
      chapters.push(chapterReport);
    }
  }

  const queueCounts = {};
  for (const { reasons } of eligibilityByRef.values()) {
    for (const reason of reasons) queueCounts[reason] = (queueCounts[reason] || 0) + 1;
  }
  const lightweightEntries = selectedEntries
    .sort((left, right) => left.courseId.localeCompare(right.courseId)
      || left.chapter.chapterId.localeCompare(right.chapter.chapterId)
      || left.questionType.localeCompare(right.questionType)
      || left.quality.curationRank - right.quality.curationRank)
    .map((entry) => ({
      ref: entry.ref,
      courseId: entry.courseId,
      chapterId: entry.chapter.chapterId,
      questionType: entry.questionType,
      rank: entry.quality.curationRank,
      verificationStatus: entry.quality.verificationStatus,
      curationReason: entry.quality.curationReason
    }));

  return {
    manifest: {
      version: CURATION_VERSION,
      targets: CURATION_TARGETS,
      entries: lightweightEntries
    },
    report: {
      version: CURATION_VERSION,
      generatedAt: new Date().toISOString(),
      targets: CURATION_TARGETS,
      totals: {
        selected: selectedEntries.length,
        choices: selectedEntries.filter((entry) => entry.questionType === "choice").length,
        essays: selectedEntries.filter((entry) => entry.questionType === "essay").length,
        chapters: chapters.length,
        completeChapters: chapters.filter((chapter) => !chapter.choiceGap && !chapter.essayGap).length,
        chaptersWithGaps: chapters.filter((chapter) => chapter.choiceGap || chapter.essayGap).length,
        choiceGap: chapters.reduce((sum, chapter) => sum + chapter.choiceGap, 0),
        essayGap: chapters.reduce((sum, chapter) => sum + chapter.essayGap, 0)
      },
      chapters,
      queueCounts,
      reviewQueue: entries
        .map((entry) => ({
          ref: entry.ref,
          courseId: entry.courseId,
          chapterId: entry.chapter.chapterId,
          questionType: entry.questionType,
          publicationStatus: entry.quality.publicationStatus,
          verificationStatus: entry.quality.verificationStatus,
          question: effectiveValue(entry, "question"),
          sourceTitle: entry.quality.sourceTitle,
          chapterStatus: entry.chapter.status,
          chapterConfidence: entry.chapter.confidence,
          chapterReference: entry.chapter.reference,
          reasons: eligibilityByRef.get(entry.ref).reasons
        }))
        .filter((entry) => entry.reasons.length)
    }
  };
}

module.exports = {
  BLOCKING_ISSUES,
  CURATION_TARGETS,
  CURATION_VERSION,
  STRONG_VERIFICATION_STATUSES,
  TEMPLATE_SOURCE_PATTERN,
  buildQuestionCuration,
  questionEligibility,
  sentenceParts,
  tooSimilar
};
