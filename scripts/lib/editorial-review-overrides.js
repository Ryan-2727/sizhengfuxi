const SOURCE_CHAPTER_RULES = [
  ["mao", /第一章\s*毛泽东思想及其历史地位/, "mao-1"],
  ["mao", /第二章\s*新民主主义革命理论/, "mao-2"],
  ["mao", /第三章\s*社会主义改造理论/, "mao-3"],
  ["mao", /第四章\s*社会主义建设道路初步探索/, "mao-4"],
  ["mao", /第五章\s*邓小平理论/, "mao-6"],
  ["mao", /第六章\s*[“\"]?三个代表/, "mao-7"],
  ["mao", /第七章\s*科学发展观/, "mao-8"],
  ["xi", /第八章\s*习近平新时代中国特色社会主义思想及其历史地位/, "xi-intro"],
  ["xi", /第九章\s*坚持和发展中国特色社会主义的总任务/, "xi-2"],
  ["marx", /习题1：唯物论与辩证法|第一章_世界的物质性及其发展规律/, "marx-1"],
  ["marx", /习题2：认识论|第二章_实践与认识及其发展规律/, "marx-2"],
  ["marx", /习题3：历史唯物主义|第三章_人类社会及其发展规律/, "marx-3"],
  ["marx", /习题4：马克思主义政治经济学/, "marx-4"]
];

const SOURCE_VERIFICATION_RULES = [
  {
    courseId: "mao",
    sourcePattern: /^毛概与习思想题库：/,
    verificationStatus: "teacher-key-verified",
    sourceKind: "teacher-material",
    verificationReference: "用户提供的课程教师发布资料目录；原文件保留题干与答案键。"
  },
  {
    courseId: "xi",
    sourcePattern: /^毛概与习思想题库：/,
    verificationStatus: "teacher-key-verified",
    sourceKind: "teacher-material",
    verificationReference: "用户提供的课程教师发布资料目录；原文件保留题干与答案键。"
  },
  {
    courseId: "marx",
    sourcePattern: /^马原本地题库：习题[1-4]：/,
    verificationStatus: "teacher-key-verified",
    sourceKind: "teacher-material",
    verificationReference: "用户提供的课程教师发布分章习题；原文件保留题干与答案键。"
  },
  {
    sourcePattern: /^用户提供真题（已核验）$/,
    verificationStatus: "authoritative-source-verified",
    sourceKind: "public-exam",
    verificationReference: "用户提供的高校公开真题及答案资料，已逐题核验题干、答案与解析。"
  }
];

const MANUAL_QUESTION_CHAPTERS = new Map([
  ["history:choice:29", "history-8"],
  ["history:choice:30", "history-9"],
  ["history:choice:113", "history-2"],
  ["history:choice:196", "history-5"],
  ["history:choice:228", "history-6"],
  ["history:choice:237", "history-6"],
  ["history:choice:331", "history-6"],
  ["history:choice:366", "history-6"],
  ["history:choice:392", "history-7"],
  ["history:choice:400", "history-7"],
  ["history:choice:408", "history-7"],
  ["history:choice:415", "history-8"],
  ["history:choice:428", "history-8"],
  ["history:choice:439", "history-7"],
  ["history:choice:440", "history-7"],
  ["history:choice:450", "history-7"],
  ["history:choice:455", "history-8"],
  ["history:choice:512", "history-8"],
  ["history:choice:566", "history-9"],
  ["history:choice:571", "history-9"],
  ["history:choice:585", "history-9"],
  ["history:choice:803", "history-8"],
  ["history:choice:895", "history-6"],
  ["history:choice:1004", "history-9"],
  ["history:choice:1007", "history-9"],
  ["history:choice:1051", "history-5"],
  ["history:choice:1055", "history-5"],
  ["history:choice:1064", "history-5"],
  ["history:choice:1065", "history-5"],
  ["history:choice:1214", "history-6"],
  ["history:essay:1", "history-intro"],
  ["history:essay:3", "history-4"],
  ["history:essay:7", "history-1"],
  ["history:essay:8", "history-intro"],
  ["history:essay:9", "history-1"],
  ["history:essay:10", "history-1"],
  ["history:essay:12", "history-2"],
  ["history:essay:13", "history-3"],
  ["history:essay:14", "history-4"],
  ["history:essay:15", "history-4"],
  ["history:essay:17", "history-6"],
  ["history:essay:18", "history-8"],
  ["history:essay:19", "history-8"],
  ["history:essay:20", "history-9"],
  ["history:essay:21", "history-9"],
  ["morality:essay:1", "morality-2"],
  ["morality:essay:2", "morality-4"],
  ["morality:essay:3", "morality-6"],
  ["morality:choice:63", "morality-intro"],
  ["mao:essay:1", "mao-1"],
  ["mao:essay:2", "mao-2"],
  ["mao:essay:3", "mao-3"],
  ["mao:essay:4", "mao-6"],
  ["xi:essay:1", "xi-intro"],
  ["xi:essay:2", "xi-2"],
  ["xi:essay:3", "xi-3"],
  ["xi:essay:19", "xi-5"],
  ["xi:essay:21", "xi-6"],
  ["xi:choice:28", "xi-2"],
  ["xi:choice:29", "xi-2"],
  ["xi:choice:35", "xi-2"],
  ["xi:choice:115", "xi-16"],
  ["xi:choice:119", "xi-15"],
  ["xi:choice:174", "xi-6"],
  ["marx:essay:1", "marx-1"],
  ["marx:essay:3", "marx-3"],
  ["marx:essay:5", "marx-intro"],
  ["marx:essay:23", "marx-2"],
  ["marx:essay:25", "marx-2"],
  ["marx:essay:52", "marx-3"],
  ["marx:essay:75", "marx-4"],
  ["marx:essay:79", "marx-5"],
  ["marx:choice:1", "marx-1"],
  ["marx:choice:13", "marx-3"]
]);

function reviewedQuestionChapter(ref) {
  const chapterId = MANUAL_QUESTION_CHAPTERS.get(ref);
  if (!chapterId) return null;
  return {
    chapterId,
    status: "verified",
    confidence: 1,
    reference: `manual-question-review:${ref}`,
    supersedesEvidence: true
  };
}

function reviewedSourceChapter(courseId, payload) {
  const source = String(payload?.source || "");
  const rule = SOURCE_CHAPTER_RULES.find(([ruleCourseId, pattern]) => ruleCourseId === courseId && pattern.test(source));
  if (!rule) return null;
  return {
    chapterId: rule[2],
    status: "verified",
    confidence: 1,
    reference: `reviewed-source-title:${source}`
  };
}

function reviewedSourceMetadata(courseId, payload) {
  const source = String(payload?.source || "");
  const rule = SOURCE_VERIFICATION_RULES.find((candidate) => {
    if (candidate.courseId && candidate.courseId !== courseId) return false;
    return candidate.sourcePattern.test(source);
  });
  return rule ? {
    verificationStatus: rule.verificationStatus,
    sourceKind: rule.sourceKind,
    verificationReference: rule.verificationReference
  } : null;
}

module.exports = {
  MANUAL_QUESTION_CHAPTERS,
  SOURCE_CHAPTER_RULES,
  SOURCE_VERIFICATION_RULES,
  reviewedQuestionChapter,
  reviewedSourceChapter,
  reviewedSourceMetadata
};
