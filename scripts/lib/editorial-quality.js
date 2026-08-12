const { createHash } = require("crypto");

const VALID_VERIFICATION_STATUSES = new Set([
  "teacher-key-verified",
  "textbook-law-verified",
  "authoritative-source-verified",
  "source-backed"
]);

const HIGH_RISK_QUESTION_PATTERN = /唯一|首要|根本|核心|最高|最大|最低|最早|最先|最主要|最重要|最根本|最本质|最突出|最深刻|最广泛|最彻底|最集中|最典型|最有力|第一次|第一个|第一部|第一批|第一要义|第一动力|第一生产力|首次|开端|转折点|决定性|本质特征|总目标|总任务|主要矛盾|中心任务|指导方针|基本路线|精髓|灵魂|法宝|标志|会议|法律|《/;

function hasHighRiskQuestionClaim(value) {
  return HIGH_RISK_QUESTION_PATTERN.test(String(value || ""));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function payloadHash(payload) {
  return sha256(stableJson(payload));
}

function questionPayloadFingerprint(courses) {
  return Object.fromEntries(courses.flatMap((course) => [
    [`${course.id}:choice`, {
      count: course.choices.length,
      hash: sha256(stableJson(course.choices.map((payload, index) => ({ order: index + 1, payload }))))
    }],
    [`${course.id}:essay`, {
      count: course.essays.length,
      hash: sha256(stableJson(course.essays.map((payload, index) => ({ order: index + 1, payload }))))
    }]
  ]));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/^\s*\d{1,5}[.、．]\s*/, "")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[，,。；;：:！？!?（）()【】\[\]“”'"《》]/g, "")
    .toLowerCase();
}

function questionStem(question) {
  const text = String(question || "");
  const firstOption = text.search(/(?:^|\n|\s)A(?:[.．、]\s*|\s+|(?=[\u4e00-\u9fff]))/);
  return firstOption >= 0 ? text.slice(0, firstOption) : text;
}

function normalizedStem(question) {
  return normalizeText(questionStem(question));
}

function characterBigrams(value) {
  const text = normalizeText(value);
  const result = new Set();
  for (let index = 0; index < text.length - 1; index += 1) result.add(text.slice(index, index + 2));
  return result;
}

function jaccard(left, right) {
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function verificationStatus(payload) {
  return VALID_VERIFICATION_STATUSES.has(payload?.auditStatus) ? payload.auditStatus : "pending";
}

function sourceMetadata(payload) {
  const source = String(payload?.source || "").trim();
  const reference = String(payload?.verificationReference || "").trim();
  const sourceKind = /教师|老师|课堂/.test(source)
    ? "teacher-material"
    : /真题|考试大纲|自学考试/.test(source)
      ? "public-exam"
      : /教材|课程|整理/.test(source)
        ? "textbook-review"
        : "question-bank";
  return {
    sourceKind,
    sourceTitle: source || null,
    verificationStatus: verificationStatus(payload),
    verificationReference: reference || null
  };
}

function questionReference(courseId, questionType, questionOrder) {
  return `${courseId}:${questionType}:${questionOrder}`;
}

module.exports = {
  HIGH_RISK_QUESTION_PATTERN,
  VALID_VERIFICATION_STATUSES,
  characterBigrams,
  jaccard,
  hasHighRiskQuestionClaim,
  normalizeText,
  normalizedStem,
  payloadHash,
  questionPayloadFingerprint,
  questionReference,
  sha256,
  sourceMetadata,
  stableJson,
  verificationStatus
};
