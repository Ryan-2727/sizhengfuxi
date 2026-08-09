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
  let modelAnswers = 0;
  let timelineEntries = 0;
  let topicPacks = 0;

  assert.equal(courseKnowledge.length, 5, "Exactly five courses are required.");
  for (const course of courseKnowledge) {
    assert(!courseIds.has(course.id), `Duplicate course id: ${course.id}`);
    courseIds.add(course.id);
    assert(course.isbn && course.edition, `${course.id} needs textbook metadata.`);
    assert(course.chapters.length > 0, `${course.id} needs chapters.`);
    const guide = course.reviewGuide;
    assert(guide, `${course.id} needs a course review guide.`);
    assert(guide.patterns?.length >= 3, `${course.id} needs high-frequency patterns.`);
    assert(guide.comparisons?.length >= 3, `${course.id} needs concept comparisons.`);
    assert(guide.mistakes?.length >= 3, `${course.id} needs common mistakes.`);
    assert(guide.answerTemplate?.length >= 3, `${course.id} needs an answer template.`);
    assert(guide.materialTopic?.title, `${course.id} needs a material-question topic.`);
    assert(guide.materialTopic.signals?.length >= 3, `${course.id} material-question topic needs signals.`);
    assert(guide.materialTopic.framework?.length >= 4, `${course.id} material-question topic needs a four-step framework.`);
    assert(guide.materialTopic.avoid, `${course.id} material-question topic needs a common mistake.`);
    assert(guide.topicPacks?.length >= 4, `${course.id} needs at least four cross-chapter topic packs.`);
    for (const pack of guide.topicPacks) {
      assert(pack.title && pack.chapters, `${course.id} has an incomplete topic-pack heading.`);
      assert(pack.core?.length >= 3, `${course.id}/${pack.title} needs at least three core points.`);
      assert(pack.pitfall && pack.practice, `${course.id}/${pack.title} needs a pitfall and practice method.`);
      topicPacks += 1;
    }
    assert(guide.modelAnswers?.length >= 2, `${course.id} needs model essay answers.`);
    for (const model of guide.modelAnswers) {
      assert(model.question && model.answer?.length >= 120, `${course.id} has an incomplete model answer.`);
      assert(model.scoring?.length >= 4, `${course.id} model answer needs scoring points.`);
      modelAnswers += 1;
    }
    for (const entry of guide.timeline || []) {
      assert(entry.date && entry.event && entry.note, `${course.id} has an incomplete timeline entry.`);
      timelineEntries += 1;
    }
    for (const chapter of course.chapters) {
      assert(!chapterIds.has(chapter.id), `Duplicate chapter id: ${chapter.id}`);
      chapterIds.add(chapter.id);
      if (chapter.sections.length) completeChapters += 1;
      const chapterPointCount = chapter.sections.reduce((count, section) => count + section.points.length, 0);
      assert(chapterPointCount >= 3, `${chapter.id} needs at least three independent knowledge points.`);
      assert(chapter.memoryOutline?.length >= 3, `${chapter.id} needs a three-step memory outline.`);
      assert(new Set(chapter.memoryOutline).size === chapter.memoryOutline.length, `${chapter.id} repeats its memory outline.`);
      assert(chapter.examPractice?.prompt, `${chapter.id} needs a chapter material-question prompt.`);
      assert(chapter.examPractice.answer?.length >= 3, `${chapter.id} needs a chapter material-question answer reference.`);
      assert(chapter.examPractice.scoring?.length >= 3, `${chapter.id} needs chapter material-question scoring points.`);
      for (const section of chapter.sections) {
        for (const item of section.points) {
          assert(!pointIds.has(item.id), `Duplicate knowledge id: ${item.id}`);
          pointIds.add(item.id);
          assert(item.keyPoints.length >= 3 && item.keyPoints.length <= 7, `${item.id} needs 3-7 key points.`);
          assert(item.keywords.length > 0, `${item.id} needs a keyword.`);
          assert(item.source?.book && item.source?.chapter && item.source?.section && item.source?.verification, `${item.id} needs source metadata.`);
          assert(/^\d+(?:-\d+)?$/.test(item.source?.page || ""), `${item.id} needs a textbook page or page range.`);
          assert(["教材小节及页码范围已核验", "待人工核验"].includes(item.source.verification), `${item.id} has an unsupported verification status.`);
          if (item.quotation) assert(item.quotation.text.length <= 30 && item.quotation.sourcePage, `${item.id} has an invalid short quotation.`);
          assert(!item.keyPoints.some((text) => /此处待补充/.test(text)), `${item.id} contains a visible placeholder.`);
          assert(!item.keyPoints.some((text) => /先判断材料对应的核心问题|回扣本章主题|具体历史阶段、理论层次或制度语境|不能只背术语名称/.test(text)), `${item.id} contains a retired generic template phrase.`);
          if (item.source.verification === "待人工核验") pendingVerification += 1;
          points += 1;
        }
      }
    }
  }
  assert.equal(completeChapters, chapterIds.size, "Every course chapter needs structured review content.");
  console.log(JSON.stringify({ courses: courseKnowledge.length, completeChapters, points, modelAnswers, timelineEntries, topicPacks, pendingVerification }));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
