const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const checks = [
  ["question-bank-audit", "scripts/audit-question-bank.js", "--quiet"],
  ["editorial-audit", "scripts/audit-editorial-quality.js"],
  ["payload-integrity", "scripts/verify-original-question-payloads.js"],
  ["editorial-quality", "scripts/verify-editorial-quality.js"],
  ["editorial-sample", "scripts/verify-editorial-sample.js"],
  ["question-coverage", "scripts/verify-question-coverage.js"],
  ["analysis-quality", "scripts/verify-analysis-quality.js"],
  ["question-navigation", "scripts/verify-question-navigation.js"],
  ["course-knowledge", "scripts/verify-course-knowledge.js"],
  ["study-tools", "scripts/verify-study-tools.js"]
];

const results = [];
for (const [name, script, ...args] of checks) {
  process.stdout.write(`\n[content:qa] ${name}\n`);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  results.push({
    name,
    command: [process.execPath, script, ...args].join(" "),
    passed: result.status === 0,
    exitCode: result.status
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  passed: results.every((item) => item.passed),
  results
};
const reportDirectory = path.join(root, "tmp");
fs.mkdirSync(reportDirectory, { recursive: true });
const reportPath = path.join(reportDirectory, "content-qa-report.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`\nContent QA report: ${reportPath}`);
if (!report.passed) process.exitCode = 1;
