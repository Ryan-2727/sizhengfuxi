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
  SOURCE_CHAPTER_RULES,
  SOURCE_VERIFICATION_RULES,
  reviewedSourceChapter,
  reviewedSourceMetadata
};
