const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

async function main() {
  const modulePath = pathToFileURL(path.join(__dirname, "..", "src", "course-knowledge.js")).href;
  const { courseKnowledge } = await import(modulePath);
  const courseIds = new Set();
  const chapterIds = new Set();
  const pointIds = new Set();
  let completeChapters = 0;
  let points = 0;
  let pendingVerification = 0;

  assert.equal(courseKnowledge.length, 5, "Exactly five courses are required.");
  for (const course of courseKnowledge) {
    assert(!courseIds.has(course.id), `Duplicate course id: ${course.id}`);
    courseIds.add(course.id);
    assert(course.isbn && course.edition, `${course.id} needs textbook metadata.`);
    assert(course.chapters.length > 0, `${course.id} needs chapters.`);
    for (const chapter of course.chapters) {
      assert(!chapterIds.has(chapter.id), `Duplicate chapter id: ${chapter.id}`);
      chapterIds.add(chapter.id);
      if (chapter.sections.length) completeChapters += 1;
      for (const section of chapter.sections) {
        for (const item of section.points) {
          assert(!pointIds.has(item.id), `Duplicate knowledge id: ${item.id}`);
          pointIds.add(item.id);
          assert(item.keyPoints.length >= 3 && item.keyPoints.length <= 7, `${item.id} needs 3-7 key points.`);
          assert(item.keywords.length > 0, `${item.id} needs a keyword.`);
          assert(item.source?.book && item.source?.chapter && item.source?.verification, `${item.id} needs source metadata.`);
          assert(!item.keyPoints.some((text) => /此处待补充/.test(text)), `${item.id} contains a visible placeholder.`);
          if (item.source.verification === "待人工核验") pendingVerification += 1;
          points += 1;
        }
      }
    }
  }
  assert(completeChapters >= 5, "Each course needs at least one complete chapter.");
  console.log(JSON.stringify({ courses: courseKnowledge.length, completeChapters, points, pendingVerification }));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
