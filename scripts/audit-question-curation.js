const fs = require("fs");
const path = require("path");
const { buildEditorialManifest } = require("./lib/editorial-manifest");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "data", "question-curation-manifest.json");
const localReportPath = path.join(root, "data", "question-bank-source", "question-curation-report.json");
const coveragePath = path.join(root, "docs", "question-curation-coverage-2026-08-12.md");

function markdown(report) {
  const lines = [
    "# 题库逐章精选覆盖报告",
    "",
    `规则版本：${report.version}`,
    "",
    "## 口径",
    "",
    "章节精选只统计已发布、章节已核验、具有教材/教师答案/权威题源证据，并通过答案与解析质量门槛的非模板化题目。目标为每章 10 道选择题和 2 道大题；不足处如实保留缺口。",
    "",
    "## 汇总",
    "",
    `- 教材章节：${report.totals.chapters}`,
    `- 已精选：${report.totals.choices} 道选择题，${report.totals.essays} 道大题`,
    `- 完整达到目标：${report.totals.completeChapters} 章`,
    `- 仍有缺口：${report.totals.chaptersWithGaps} 章`,
    `- 总缺口：${report.totals.choiceGap} 道选择题，${report.totals.essayGap} 道大题`,
    "",
    "## 逐章覆盖",
    "",
    "| 课程 | 章节 | 合格候选（选择/大题） | 已精选（选择/大题） | 缺口（选择/大题） |",
    "| --- | --- | ---: | ---: | ---: |"
  ];
  for (const chapter of report.chapters) {
    lines.push(`| ${chapter.courseTitle} | ${chapter.chapterTitle} | ${chapter.choiceEligible}/${chapter.essayEligible} | ${chapter.choiceSelected}/${chapter.essaySelected} | ${chapter.choiceGap}/${chapter.essayGap} |`);
  }
  lines.push(
    "",
    "## 待复核说明",
    "",
    "完整待复核队列位于本地且被 Git 忽略的 `data/question-bank-source/question-curation-report.json`。该文件包含题干，仅用于编辑审计，不进入静态部署。公开仓库只保留 `data/question-curation-manifest.json` 中不含题干、答案和解析的轻量引用。",
    ""
  );
  return lines.join("\n");
}

async function main() {
  const editorial = await buildEditorialManifest();
  fs.mkdirSync(path.dirname(localReportPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(editorial.curation, null, 2)}\n`, "utf8");
  fs.writeFileSync(localReportPath, `${JSON.stringify(editorial.curationReport, null, 2)}\n`, "utf8");
  fs.writeFileSync(coveragePath, markdown(editorial.curationReport), "utf8");
  console.table([editorial.curationReport.totals]);
  console.log(`Lightweight curation manifest: ${manifestPath}`);
  console.log(`Local detailed review queue: ${localReportPath}`);
  console.log(`Coverage report: ${coveragePath}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
