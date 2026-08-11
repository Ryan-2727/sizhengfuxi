const assert = require("assert");
const { loadQuestionBank } = require("./lib/load-question-bank");
const { questionPayloadFingerprint } = require("./lib/editorial-quality");

const EXPECTED = {
  "history:choice": { count: 1310, hash: "ae7965c19d31107111f95365cc0df4ae85ccf1d78a67fd27b3d27cc79e921377" },
  "history:essay": { count: 22, hash: "185ee51cbfffe82abf9897a677b7c5f739816dd86cc0d4f6fde028374e0aafcc" },
  "morality:choice": { count: 401, hash: "35788b2243d7c1baed1c21f9a6cd9a489341c775f98213847858b3b62c57776c" },
  "morality:essay": { count: 5, hash: "63f6bdcee41ebdb4f123c813de45c307a81249eda5bf4a6332781637b28d6084" },
  "mao:choice": { count: 958, hash: "e513ad48b11b4136f533ca1272212c1ac4a50cec9750e1984f31998a65dd921f" },
  "mao:essay": { count: 55, hash: "b7a76fba59e53d6129de07db601781c3e4df36b0652934402fb8d753e361a272" },
  "xi:choice": { count: 179, hash: "42b414e7fc55efce8945ba81d340cb6120df6080afb2f06f94cd33f85f43808f" },
  "xi:essay": { count: 24, hash: "2a6a1b6e07ac6daba13fe57883ca5765a776dd25392fa89b85c4e10f00e5388e" },
  "marx:choice": { count: 281, hash: "18c0804ed257677dfd0607f0282ef659e9ef7c7fafc381059e5bd70405daad03" },
  "marx:essay": { count: 97, hash: "c63f69a14e6b07389d226cb76712db00148a12d62471c0694c3a62e5d5125171" }
};

const { courses } = loadQuestionBank({ includeExpansion: false });
const actual = questionPayloadFingerprint(courses);

for (const [key, expected] of Object.entries(EXPECTED)) {
  assert.deepEqual(actual[key], expected, `${key} original payload baseline changed`);
}
assert.deepEqual(Object.keys(actual).sort(), Object.keys(EXPECTED).sort(), "Course/type payload groups changed");
console.table(actual);
console.log("Original question payload baseline passed.");
