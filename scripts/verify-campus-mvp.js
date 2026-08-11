const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

(async () => {
  const html = read("index.html");
  const app = read("app.js");
  const redirects = read("public/_redirects");
  const moduleUrl = `${pathToFileURL(path.join(root, "src", "campus-preview.js")).href}?verify=${Date.now()}`;
  const { campusPreview } = await import(moduleUrl);

  assert(/id="campusView"/.test(html), "The public campus landing view is missing.");
  assert(/id="homePreviewBtn"/.test(html) && /id="campusPreviewBtn"/.test(html), "Free preview entry points are missing.");
  assert(/id="feedbackForm"/.test(html), "The feedback form is missing.");
  assert(/id="copyCampusLinkBtn"/.test(html), "The campus share control is missing.");
  assert(/大学思政期末复习｜思政复习/.test(html), "Campus title metadata is missing.");
  assert(/shouldCreateUser:\s*false/.test(app), "The existing no-self-registration OTP rule changed.");
  assert(/CAMPUS_SOURCES/.test(app) && /sizheng-campus-source-v1/.test(app), "Campus source attribution is missing.");
  assert(/sessionState\.preview/.test(app), "Preview access mode is missing.");
  assert(/recent:\s*saved\?\.recent/.test(app), "Free preview and member mode must share recent-study progress.");
  assert(/function localCourseProgress\(/.test(app), "Course-level local progress summary is missing.");
  assert(/会员至/.test(app) && /id="membershipStatus"/.test(html), "Valid-member expiry status is missing.");
  assert(/\/\* \/index\.html 200/.test(redirects), "Cloudflare SPA fallback is missing.");
  assert(campusPreview.courseId === "history" && campusPreview.chapterId === "history-1", "Preview must stay inside the configured history chapter.");
  assert(campusPreview.choices.length === 20, "Campus preview must contain exactly 20 choice questions.");
  assert(campusPreview.essays.length > 0 && campusPreview.essays.length <= 5, "Campus preview essay count is outside the allowed limit.");
  assert([...campusPreview.choices, ...campusPreview.essays].every((item) => item.question && item.answer && item.analysis), "Every preview question needs a question, answer and analysis.");
  assert([...campusPreview.choices, ...campusPreview.essays].every((item) => item.chapterId === campusPreview.chapterId), "Preview questions must not expose another chapter.");
  console.log(`Campus MVP contract passed: ${campusPreview.choices.length} choice questions and ${campusPreview.essays.length} essays.`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
