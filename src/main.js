import { supabase } from "./supabase-client.js";
import { courseKnowledge } from "./course-knowledge.js";
import {
  deleteUserQuestionCaches,
  getCourseQuestionCache,
  putCourseQuestionCache
} from "./question-bank-cache.js";

window.studySupabase = supabase;
window.courseKnowledge = courseKnowledge;
window.questionBankCache = {
  deleteUserQuestionCaches,
  getCourseQuestionCache,
  putCourseQuestionCache
};
import("../app.js");
