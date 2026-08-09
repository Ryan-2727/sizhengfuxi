const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

assert(app.includes("data-question-nav-toggle"), "Question navigation toggle is missing.");
assert(app.includes('data-question-nav-type="选择题"'), "Choice navigation entry is missing.");
assert(app.includes('data-question-nav-type="大题"'), "Essay navigation entry is missing.");
assert(app.includes('aria-expanded="${expanded}"'), "Question navigation does not expose expanded state.");
assert(css.includes(".question-nav-sub"), "Question navigation animation styles are missing.");
assert(css.includes("prefers-reduced-motion: reduce"), "Reduced-motion support is missing.");

console.log("Question navigation static contract passed.");
