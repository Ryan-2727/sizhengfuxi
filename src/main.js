import { supabase } from "./supabase-client.js";
import { courseKnowledge } from "./course-knowledge.js";
import { reviewedQuestionChapterRules } from "./question-chapter-rules.js";
import { enrichChoiceAnalysis, enrichEssayAnalysis } from "./question-analysis.js";
import { campusPreview } from "./campus-preview.js";
import { MEMBERSHIP_DAYS, MEMBERSHIP_PLAN, MEMBERSHIP_PRICE, membershipPriceLabel } from "./billing-config.js";
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
window.billingConfig = { MEMBERSHIP_DAYS, MEMBERSHIP_PLAN, MEMBERSHIP_PRICE, membershipPriceLabel };
window.questionBankCache = {
  deleteUserQuestionCaches,
  getCourseQuestionCache,
  putCourseQuestionCache
};
import("../app.js");
