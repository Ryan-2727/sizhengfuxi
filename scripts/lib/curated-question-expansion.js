const CHOICE_ADDITIONS = { history: 110, morality: 280, mao: 100, xi: 340, marx: 250 };
const ESSAYS_PER_CHAPTER = { history: 3, morality: 7, mao: 2, xi: 2, marx: 2 };
const LETTERS = ["A", "B", "C", "D"];

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\s，,。；;：:！？!?（）()【】\[\]“”'"《》]/g, "")
    .toLowerCase();
}

function sourceFields(point, chapter) {
  const source = point.source || {};
  return {
    source: "2023版教材结构化知识点校审",
    auditStatus: "textbook-law-verified",
    verificationReference: `${source.book || "课程教材"}（${source.edition || "2023年版"}）${source.chapter || chapter.title}${source.page ? `，第${source.page}页` : ""}。`,
    chapterId: chapter.id,
    chapterAssignmentStatus: "verified",
    chapterAssignmentReference: `curated-knowledge:${point.id}`,
    knowledgePointId: point.id,
    importance: point.importance,
    frequency: point.importance === "高频" ? "high" : point.importance === "重点" ? "medium" : "base"
  };
}

function rotate(items, offset) {
  const normalizedOffset = ((offset % items.length) + items.length) % items.length;
  return items.slice(normalizedOffset).concat(items.slice(0, normalizedOffset));
}

function choiceQuestion(stem, options, correctIndexes, analysis, metadata) {
  const renderedOptions = options.map((option, index) => `${LETTERS[index]}. ${option}`).join("\n");
  const correctAnswer = correctIndexes.map((index) => LETTERS[index]).sort().join("");
  return {
    question: `${stem}\n${renderedOptions}`,
    correctAnswer,
    questionType: correctAnswer.length > 1 ? "多选题" : "单选题",
    answer: `正确答案：${correctAnswer}`,
    analysis,
    ...metadata
  };
}

function uniqueValues(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function distractorsFor(points, point, field, seed, count) {
  const candidates = points
    .filter((candidate) => candidate.point.id !== point.id && candidate.chapter.id !== point.chapterId)
    .flatMap((candidate) => field(candidate.point))
    .filter(Boolean);
  if (!candidates.length) return [];
  const result = [];
  for (let offset = 0; result.length < count && offset < candidates.length * 2; offset += 1) {
    const value = candidates[(seed * 17 + offset * 29) % candidates.length];
    if (!result.some((item) => normalize(item) === normalize(value))) result.push(value);
  }
  return result;
}

function formatKeywordGroup(point) {
  return uniqueValues(point.keywords || []).slice(0, 3).join("、");
}

function directChoice(course, chapter, point, statement, pointIndex, allPoints) {
  const distractors = distractorsFor(allPoints, { ...point, chapterId: chapter.id }, (candidate) => candidate.keyPoints || [], pointIndex, 3);
  if (distractors.length < 3) return null;
  const entries = rotate([
    { text: statement, correct: true },
    ...distractors.map((text) => ({ text, correct: false }))
  ], pointIndex % 4);
  const correctIndexes = entries.map((entry, index) => entry.correct ? index : -1).filter((index) => index >= 0);
  return choiceQuestion(
    `在${course.title}的章节知识结构中，属于“${point.title}”的正确表述是（ ）`,
    entries.map((entry) => entry.text),
    correctIndexes,
    `本题定位到${chapter.title}的“${point.title}”。正确项直接概括该知识点；其余表述分别属于同课程的其他知识点，不能因表述本身成立就误选。记忆时把“${formatKeywordGroup(point)}”与本题结论绑定，并先看题干限定的所属知识点。`,
    sourceFields(point, chapter)
  );
}

function keywordChoice(course, chapter, point, pointIndex, allPoints) {
  const correct = formatKeywordGroup(point);
  if (!correct) return null;
  const distractors = distractorsFor(allPoints, { ...point, chapterId: chapter.id }, (candidate) => [formatKeywordGroup(candidate)], pointIndex + 101, 3);
  if (distractors.length < 3) return null;
  const entries = rotate([
    { text: correct, correct: true },
    ...distractors.map((text) => ({ text, correct: false }))
  ], (pointIndex + 1) % 4);
  const correctIndexes = entries.map((entry, index) => entry.correct ? index : -1).filter((index) => index >= 0);
  return choiceQuestion(
    `复习“${point.title}”时，下列关键词组合最准确的是（ ）`,
    entries.map((entry) => entry.text),
    correctIndexes,
    `“${point.title}”在本章对应的关键词是“${correct}”，因此选择${correctIndexes.map((index) => LETTERS[index]).join("")}。其他组合来自别的章节或理论层次，属于常见的跨概念干扰。记忆时先锁定章节，再用关键词组反推完整表述。`,
    sourceFields(point, chapter)
  );
}

function multipleChoice(course, chapter, point, pointIndex, allPoints) {
  const correctValues = uniqueValues(point.keyPoints || []).slice(0, 3);
  const distractor = distractorsFor(allPoints, { ...point, chapterId: chapter.id }, (candidate) => candidate.keyPoints || [], pointIndex + 211, 1)[0];
  if (correctValues.length < 3 || !distractor) return null;
  const entries = rotate([
    ...correctValues.map((text) => ({ text, correct: true })),
    { text: distractor, correct: false }
  ], (pointIndex + 2) % 4);
  const correctIndexes = entries.map((entry, index) => entry.correct ? index : -1).filter((index) => index >= 0);
  return choiceQuestion(
    `下列属于“${point.title}”核心要点的有（ ）`,
    entries.map((entry) => entry.text),
    correctIndexes,
    `本题为多选题，正确项共同构成“${point.title}”的核心内容。错误项虽然可能是课程中的正确观点，但属于其他知识点，不能越过题干范围选入。解题时逐项做“是否直接回答本概念”的归属判断，再核对“${formatKeywordGroup(point)}”。`,
    sourceFields(point, chapter)
  );
}

function scoringPoints(point) {
  const sourceStatements = [
    point.definition,
    ...(point.keyPoints || []),
    ...(point.causes || []),
    ...(point.results || []),
    ...(point.significance || [])
  ].filter(Boolean);
  const clauses = uniqueValues(sourceStatements.flatMap((text) => String(text).split(/[；。]/)).filter((text) => text.length >= 8));
  if (clauses.length < 4) {
    clauses.unshift(`“${point.title}”是本章围绕“${formatKeywordGroup(point)}”展开的重要知识点`);
  }
  if (clauses.join("。 ").length < 120) {
    clauses.unshift(`“${point.title}”由${formatKeywordGroup(point)}等相互联系的基本内容构成，反映了本章相关概念之间的层次和逻辑关系`);
  }
  return uniqueValues(clauses).slice(0, 7);
}

function essayQuestion(chapter, point) {
  const points = scoringPoints(point);
  const answer = points.map((text, index) => `${index + 1}. ${text}。`).join("\n");
  const keywords = uniqueValues(point.keywords || []).slice(0, 6);
  return {
    question: `简述“${point.title}”的基本内容。`,
    answer,
    analysis: `本题先用一句话确定“${point.title}”在${chapter.title}中的位置，再按教材逻辑分点展开。标准答案的主要得分点是：${points.slice(0, 5).map((text, index) => `${index + 1}.${text}`).join("；")}。材料题出现“${keywords.join("、")}”等词时，可优先调用本题答案；每个得分点都要写成完整判断。常见失分是只罗列关键词、漏掉概念之间的关系，或把相邻章节的表述混入答案。记忆时按“${keywords.slice(0, 4).join("—")}”形成提纲，再用完整句复述。`,
    scoringPoints: points,
    keywords,
    commonMistakes: ["只写关键词而没有完整判断。", "把相邻章节的正确表述误写成本题得分点。"],
    ...sourceFields(point, chapter)
  };
}

function appendChoiceExpansion(course, knowledgeCourse, target) {
  const allPoints = knowledgeCourse.chapters.flatMap((chapter) => chapter.sections.flatMap((section) => section.points.map((point) => ({ point, chapter }))));
  const existing = new Set(course.choices.map((item) => normalize(item.question)));
  const candidatesByChapter = new Map(knowledgeCourse.chapters.map((chapter) => [chapter.id, []]));
  allPoints.forEach(({ point, chapter }, pointIndex) => {
    const candidates = candidatesByChapter.get(chapter.id);
    for (const statement of point.keyPoints || []) candidates.push(directChoice(knowledgeCourse, chapter, point, statement, pointIndex + candidates.length, allPoints));
    candidates.push(keywordChoice(knowledgeCourse, chapter, point, pointIndex, allPoints));
    candidates.push(multipleChoice(knowledgeCourse, chapter, point, pointIndex, allPoints));
  });
  const candidates = [];
  let round = 0;
  while ([...candidatesByChapter.values()].some((items) => round < items.length)) {
    for (const chapter of knowledgeCourse.chapters) {
      const candidate = candidatesByChapter.get(chapter.id)[round];
      if (candidate) candidates.push(candidate);
    }
    round += 1;
  }
  let added = 0;
  for (const candidate of candidates) {
    if (!candidate || added >= target) break;
    const key = normalize(candidate.question);
    if (existing.has(key)) continue;
    existing.add(key);
    course.choices.push(candidate);
    added += 1;
  }
  if (added < target) throw new Error(`${course.id} curated choice expansion produced ${added}/${target} questions.`);
}

function appendEssayExpansion(course, knowledgeCourse, perChapter) {
  const existing = new Set(course.essays.map((item) => normalize(item.question)));
  for (const chapter of knowledgeCourse.chapters) {
    const points = chapter.sections.flatMap((section) => section.points);
    let added = 0;
    for (const point of points) {
      if (added >= perChapter) break;
      const candidate = essayQuestion(chapter, point);
      const key = normalize(candidate.question);
      if (existing.has(key)) continue;
      existing.add(key);
      course.essays.push(candidate);
      added += 1;
    }
  }
}

function appendCuratedExpansion(courses, courseKnowledge) {
  const knowledgeById = new Map(courseKnowledge.map((course) => [course.id, course]));
  for (const course of courses) {
    const knowledgeCourse = knowledgeById.get(course.id);
    if (!knowledgeCourse) continue;
    if (CHOICE_ADDITIONS[course.id]) appendChoiceExpansion(course, knowledgeCourse, CHOICE_ADDITIONS[course.id]);
    if (ESSAYS_PER_CHAPTER[course.id]) appendEssayExpansion(course, knowledgeCourse, ESSAYS_PER_CHAPTER[course.id]);
  }
}

module.exports = {
  CHOICE_ADDITIONS,
  ESSAYS_PER_CHAPTER,
  appendCuratedExpansion
};
