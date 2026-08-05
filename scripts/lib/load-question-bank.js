const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..", "..");
const sourceDirectory = path.join(root, "data", "question-bank-source");
const sourceFiles = [
  "history-local-question-bank.js",
  "morality-local-question-bank.js",
  "mao-xi-local-question-bank.js",
  "marx-local-question-bank.js",
  "verified-question-overrides.js",
  "app-with-question-seed.js"
];

const noop = () => {};
const fakeElement = () => ({
  hidden: false,
  innerHTML: "",
  textContent: "",
  dataset: {},
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  addEventListener: noop,
  querySelector: () => fakeElement(),
  querySelectorAll: () => [],
  append: noop,
  setAttribute: noop,
  style: { setProperty: noop },
  showModal: noop
});

function loadQuestionBank() {
  const sandbox = {
    console,
    window: { scrollTo: noop },
    location: { hash: "", pathname: "/", search: "" },
    history: { pushState: noop },
    document: {
      createElement: () => fakeElement(),
      documentElement: { style: { setProperty: noop } },
      querySelector: () => fakeElement(),
      querySelectorAll: () => []
    }
  };
  vm.createContext(sandbox);
  const source = sourceFiles
    .map((file) => fs.readFileSync(path.join(sourceDirectory, file), "utf8"))
    .join("\n");
  vm.runInContext(`${source}
globalThis.__questionBankApi = {
  courses,
  parseChoiceOptions,
  choiceAnswerLetters,
  choiceAnalysis,
  stableQuestionId
};`, sandbox);
  return sandbox.__questionBankApi;
}

module.exports = { loadQuestionBank, root, sourceDirectory, sourceFiles };
