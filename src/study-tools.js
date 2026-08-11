export const WRONG_REASON_LABELS = {
  "knowledge-gap": "知识盲点",
  "concept-confusion": "概念混淆",
  "timeline-order": "时间顺序",
  "reading-error": "审题失误",
  "multi-omission": "多选漏选",
  "essay-memory": "背诵不牢"
};

export const CONTENT_CHANGELOG = [
  {
    date: "2026-08-11",
    title: "题库质量分层",
    detail: "增加章节定位、来源和审校状态；重复、来源待核验或无法可靠归类的记录不向会员题库发布。",
    courses: ["history", "morality", "mao", "xi", "marx"]
  },
  {
    date: "2026-08-11",
    title: "章节练习补强",
    detail: "按五本指定版本教材的结构化知识点补充精选练习，并为新增题关联对应章节和知识点。",
    courses: ["history", "morality", "mao", "xi", "marx"]
  },
  {
    date: "2026-08-11",
    title: "大题自检结构",
    detail: "大题答案区统一展示完整答案、得分点、关键词、常见失分和解题解析，便于背诵后逐项核对。",
    courses: ["history", "morality", "mao", "xi", "marx"]
  }
];

function answerLetters(item) {
  const direct = String(item.correctAnswer || "").toUpperCase().match(/[A-F]/g);
  if (direct?.length) return [...new Set(direct)].sort().join("");
  const match = String(item.answer || "").toUpperCase().match(/(?:答案|正确答案)?\s*[:：]?\s*([A-F]{1,6})/);
  return match ? [...new Set(match[1])].sort().join("") : "";
}

export function questionFrequency(item) {
  if (item.frequency === "high" || item.importance === "高频") return "高频";
  if (item.frequency === "medium" || item.importance === "重点") return "重点";
  return "基础";
}

export function questionDifficulty(item) {
  if (["基础", "中等", "较难"].includes(item.difficulty)) return item.difficulty;
  if (item.type === "大题") return item.importance === "高频" ? "较难" : "中等";
  if (answerLetters(item).length > 1) return "较难";
  return item.importance === "高频" ? "中等" : "基础";
}

export function inferWrongReason(item, selected, correctAnswer) {
  if (item.type === "大题") return "essay-memory";
  const selectedLetters = new Set(String(selected || ""));
  const correctLetters = new Set(String(correctAnswer || ""));
  const onlyCorrectSelections = [...selectedLetters].every((letter) => correctLetters.has(letter));
  if (correctLetters.size > 1 && onlyCorrectSelections && selectedLetters.size < correctLetters.size) return "multi-omission";
  if (/时间|年代|先后|最早|开始于|结束于|年份|世纪/.test(item.question || "")) return "timeline-order";
  if (/不正确|错误|不包括|不能|不是|不属于/.test(item.question || "")) return "reading-error";
  if ([...selectedLetters].some((letter) => !correctLetters.has(letter))) return "concept-confusion";
  return "knowledge-gap";
}

function shuffled(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function chapterBalancedSample(items, size, random) {
  const groups = new Map();
  for (const item of shuffled(items, random)) {
    const chapterId = item.chapterInfo?.id || item.chapterId || "unclassified";
    if (!groups.has(chapterId)) groups.set(chapterId, []);
    groups.get(chapterId).push(item);
  }
  const queues = shuffled([...groups.values()], random);
  const selected = [];
  while (selected.length < size && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      if (selected.length >= size) break;
      if (queue.length) selected.push(queue.shift());
    }
  }
  return selected;
}

export function buildMockExam(items, options = {}) {
  const random = options.random || Math.random;
  const targets = {
    single: options.single ?? 30,
    multiple: options.multiple ?? 10,
    essay: options.essay ?? 3
  };
  const choices = items.filter((item) => item.type === "选择题");
  const essays = items.filter((item) => item.type === "大题");
  const singles = choices.filter((item) => answerLetters(item).length === 1);
  const multiples = choices.filter((item) => answerLetters(item).length > 1);
  const selected = [
    ...chapterBalancedSample(singles, Math.min(targets.single, singles.length), random),
    ...chapterBalancedSample(multiples, Math.min(targets.multiple, multiples.length), random),
    ...chapterBalancedSample(essays, Math.min(targets.essay, essays.length), random)
  ];
  const selectedIds = new Set(selected.map((item) => item.questionId));
  const choiceGap = Math.min(targets.single + targets.multiple, choices.length)
    - selected.filter((item) => item.type === "选择题").length;
  if (choiceGap > 0) {
    const fillers = chapterBalancedSample(choices.filter((item) => !selectedIds.has(item.questionId)), choiceGap, random);
    for (const item of fillers) {
      selected.push(item);
      selectedIds.add(item.questionId);
    }
  }
  return {
    questionIds: selected.map((item) => item.questionId),
    choiceCount: selected.filter((item) => item.type === "选择题").length,
    essayCount: selected.filter((item) => item.type === "大题").length,
    chapterCount: new Set(selected.map((item) => item.chapterInfo?.id || item.chapterId)).size
  };
}
