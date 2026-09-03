const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadQuestionBank } = require("./lib/load-question-bank");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

assert(app.includes("data-question-nav-toggle"), "Question navigation toggle is missing.");
assert(app.includes('data-question-nav-type="选择题"'), "Choice navigation entry is missing.");
assert(app.includes('data-question-nav-type="大题"'), "Essay navigation entry is missing.");
assert(app.includes('aria-expanded="${expanded}"'), "Question navigation does not expose expanded state.");
assert(app.includes("function bindCourseSectionNavigation"), "Course section navigation binding is missing.");
assert(app.includes('a[href^="#"]:not([data-question-nav-type])'), "Course section links are not isolated from question filters.");
assert(/function bindCourseSectionNavigation[\s\S]*?event\.preventDefault\(\)[\s\S]*?scrollIntoView/.test(app), "Course section navigation must prevent route hash changes and scroll in place.");
assert(app.includes("function cleanQuestionText"), "Question display cleanup is missing.");
assert(css.includes(".question-nav-sub"), "Question navigation animation styles are missing.");
assert(css.includes("prefers-reduced-motion: reduce"), "Reduced-motion support is missing.");

const { courses } = loadQuestionBank();
const placeholderQuestions = courses.flatMap((course) => [
  ...course.choices,
  ...course.essays
]).filter((item) => String(item.question || "").includes("undefined"));
assert.equal(placeholderQuestions.length, 0, "Generated question bank still contains an undefined course placeholder.");

console.log("Question navigation static contract passed.");
