import { apiError, json, readJson, requestUser, serviceClient } from "../../_shared/billing.js";
import { consumeRequestLimit, publicRequestError, verifyTurnstile } from "../../_shared/public-request.js";

const FEEDBACK_TYPES = new Set(["题目错误", "知识点错误", "网站 Bug", "功能建议", "其他"]);

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return {
    course: cleanText(value.course, 160),
    chapter: cleanText(value.chapter, 200),
    courseId: cleanText(value.courseId, 80),
    questionId: cleanText(value.questionId, 120),
    questionDatabaseId: cleanText(value.questionDatabaseId, 80),
    currentRevisionId: cleanText(value.currentRevisionId, 80),
    catalogHash: cleanText(value.catalogHash, 80),
    question: cleanText(value.question, 500)
  };
}

function cleanPageUrl(value) {
  const candidate = cleanText(value, 2000);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function notifyAdministrator(env, feedback) {
  if (!env.RESEND_API_KEY || !env.FEEDBACK_NOTIFY_EMAIL || !env.FEEDBACK_FROM_EMAIL) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: env.FEEDBACK_FROM_EMAIL,
      to: String(env.FEEDBACK_NOTIFY_EMAIL).split(",").map((email) => email.trim()).filter(Boolean),
      subject: `[思政复习反馈] ${feedback.type} · ${feedback.feedback_no}`,
      text: [
        `反馈编号：${feedback.feedback_no}`,
        `问题类型：${feedback.type}`,
        `反馈内容：${feedback.content}`,
        `联系方式：${feedback.contact || "未填写"}`,
        `登录邮箱：${feedback.user_email || "匿名用户"}`,
        `页面：${feedback.page_url || "未记录"}`,
        `提交时间：${feedback.created_at}`,
        "",
        "请登录网站管理员反馈收件箱处理：/admin/feedback"
      ].join("\n")
    })
  });
  if (!response.ok) throw new Error(`Feedback email failed with ${response.status}.`);
  return true;
}

export async function onRequestPost({ request, env }) {
  try {
    const payload = await readJson(request);
    if (cleanText(payload.website, 200)) return json({ accepted: true });
    const type = cleanText(payload.type, 40);
    const content = cleanText(payload.content, 4000);
    const contact = cleanText(payload.contact, 200) || null;
    const pageUrl = cleanPageUrl(payload.page_url);
    if (!FEEDBACK_TYPES.has(type)) return apiError("请选择有效的问题类型。", 400);
    if (content.length < 5) return apiError("请至少填写 5 个字的反馈内容。", 400);
    await verifyTurnstile({ request, env, token: payload.turnstile_token, action: "feedback" });
    await consumeRequestLimit({ request, env, action: "feedback", windowSeconds: 3600, limit: 20 });
    const user = await requestUser(request, env);
    const service = serviceClient(env);
    const context = cleanContext(payload.context);
    const { data, error } = await service.from("feedback").insert({
      type,
      content,
      contact,
      context,
      question_ref: context.questionId || null,
      question_database_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.questionDatabaseId)
        ? context.questionDatabaseId
        : null,
      page_url: pageUrl,
      user_id: user?.id || null,
      user_email: user?.email || null
    }).select("feedback_no, type, content, contact, page_url, user_email, created_at").single();
    if (error) throw error;
    let notified = false;
    try {
      notified = await notifyAdministrator(env, data);
    } catch (error) {
      console.error("Feedback was saved but email notification failed.", error);
    }
    return json({ accepted: true, feedback_no: data.feedback_no, notified }, 201);
  } catch (error) {
    console.error("Feedback submission failed.", error);
    const response = publicRequestError(error, "暂时无法提交反馈，请稍后重试。", 500);
    return apiError(response.message, response.status);
  }
}
