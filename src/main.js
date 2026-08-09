import { supabase } from "./supabase-client.js";
import { courseKnowledge } from "./course-knowledge.js";
import { reviewedQuestionChapterRules } from "./question-chapter-rules.js";
import { enrichChoiceAnalysis, enrichEssayAnalysis } from "./question-analysis.js";
import { campusPreview } from "./campus-preview.js";
import {
  deleteUserQuestionCaches,
  getCourseQuestionCache,
  putCourseQuestionCache
} from "./question-bank-cache.js";

window.studySupabase = supabase;
window.courseKnowledge = courseKnowledge;
window.questionChapterRules = reviewedQuestionChapterRules;
window.questionAnalysis = { enrichChoiceAnalysis, enrichEssayAnalysis };
window.campusPreview = campusPreview;
window.questionBankCache = {
  deleteUserQuestionCaches,
  getCourseQuestionCache,
  putCourseQuestionCache
};
import("../app.js");
