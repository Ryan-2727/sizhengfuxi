import { supabase } from "./supabase-client.js";
import {
  deleteUserQuestionCaches,
  getCourseQuestionCache,
  putCourseQuestionCache
} from "./question-bank-cache.js";

window.studySupabase = supabase;
window.questionBankCache = {
  deleteUserQuestionCaches,
  getCourseQuestionCache,
  putCourseQuestionCache
};
import("../app.js");
