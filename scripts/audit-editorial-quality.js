const fs = require("fs");
const path = require("path");
const { buildEditorialManifest } = require("./lib/editorial-manifest");

async function main() {
  const manifest = await buildEditorialManifest();
  const outputDirectory = path.join(__dirname, "..", "data", "question-bank-source");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const manifestPath = path.join(outputDirectory, "editorial-quality-manifest.json");
  const reportPath = path.join(outputDirectory, "editorial-quality-report.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(reportPath, `${JSON.stringify(manifest.report, null, 2)}\n`, "utf8");
  const curationReportPath = path.join(outputDirectory, "question-curation-report.json");
  fs.writeFileSync(curationReportPath, `${JSON.stringify(manifest.curationReport, null, 2)}\n`, "utf8");
  console.table([manifest.report.totals]);
  console.log(`Editorial manifest: ${manifestPath}`);
  console.log(`Editorial report: ${reportPath}`);
  console.log(`Question curation report: ${curationReportPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
