function normalize(value) {
  return String(value || "")
    .replace(/^\s*解析[:：]\s*/, "")
    .replace(/\?{5,}/g, "")
    .trim();
}

export function analysisSentences(value) {
  return (normalize(value).match(/[^。！？!?\n]+[。！？!?]?/g) || [])
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function endSentence(value) {
  const text = normalize(value);
  if (!text) return "";
  return /[。！？!?；;]$/.test(text) ? text : `${text}。`;
}

function shortQuestionKey(question) {
  const stem = String(question || "")
    .split(/(?:^|\n|\s)A(?:[.．、]\s*|\s+)/)[0]
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/[？?。；;：:，,\s]/g, "");
  return stem.slice(0, 18) || "题干关键词";
}

function optionLabel(letter, options) {
  return options?.[letter] ? `${letter}. ${options[letter]}` : letter;
}

export function enrichChoiceAnalysis({ question, analysis, letters, options }) {
  const answerLetters = String(letters || "").replace(/[^A-F]/g, "");
  const base = analysisSentences(analysis);
  const correct = [...answerLetters].map((letter) => optionLabel(letter, options));
  const wrong = Object.keys(options || {}).filter((letter) => !answerLetters.includes(letter));
  const result = [...base];

  if (!result.length) {
    result.push(`本题应依据题干中的“${shortQuestionKey(question)}”判断规范表述。`);
  }
  const correctOptionMissing = [...answerLetters].some((letter) => options?.[letter] && !result.join("").includes(options[letter]));
  if (correct.length && (result.length < 2 || correctOptionMissing)) {
    result.push(`答案定位：${correct.join("；")}与题干要求相符。`);
  }
  if (answerLetters.length > 1 && !result.join("").includes("未入选项")) {
    const excluded = wrong.length ? `；未入选项${wrong.join("、")}不属于本题答案范围` : "";
    result.push(`选项辨析：本题为多选题，应逐项保留${answerLetters.split("").join("、")}${excluded}。`);
  } else if (result.length < 3 && correct.length) {
    result.push(`记忆提示：将“${shortQuestionKey(question)}”与“${options?.[answerLetters] || correct[0]}”对应复习。`);
  }
  return result.map(endSentence).filter(Boolean).join("\n");
}

function answerKeywords(answer) {
  const quoted = [...String(answer || "").matchAll(/[“《]([^”》]{2,14})[”》]/g)].map((match) => match[1]);
  return [...new Set(quoted)].slice(0, 5);
}

export function enrichEssayAnalysis({ question, analysis, answer, keywords = [] }) {
  const result = analysisSentences(analysis);
  const memoryKeys = [...new Set((keywords.length ? keywords : answerKeywords(answer))
    .map((item) => String(item).trim())
    .filter((item) => item.length >= 2 && item.length <= 14))].slice(0, 5);
  if (!result.length) {
    result.push(`解题定位：题干要求围绕“${shortQuestionKey(question)}”组织完整结论。`);
  }
  const baseText = result.join("");
  const additions = [
    !/考查|定位|题干|设问/.test(baseText) ? `解题定位：先确认“${shortQuestionKey(question)}”所对应的知识范围，再组织答案。` : "",
    !/得分|作答|答案|先写|必须|完整/.test(baseText) ? "得分逻辑：先写核心判断，再按标准答案的层次逐点展开，每一点都形成完整表述。" : "",
    !/记忆|口诀|链条/.test(baseText) ? (memoryKeys.length >= 2
      ? `记忆顺序：先记“${memoryKeys.join("—")}”主线，再补充每个关键词的解释。`
      : "记忆顺序：先记结论句和分点标题，再补充每一分点的依据、关系或意义。") : "",
    "答题检查：完成后逐项核对题干要求，避免遗漏结论、依据或层次关系。",
    "表达要求：每个得分点先写明确结论，再补充必要解释，避免只罗列关键词。"
  ].filter(Boolean);
  while (result.length < 4 && additions.length) result.push(additions.shift());
  return result.map(endSentence).filter(Boolean).join("\n");
}
