import { apiError, json, readJson, requireAdmin, serviceClient } from "../../../_shared/billing.js";

const FEEDBACK_STATUSES = new Set(["new", "reviewing", "resolved", "ignored"]);

export async function onRequestPatch({ request, env, params }) {
  try {
    const admin = await requireAdmin(request, env);
    const payload = await readJson(request);
    const status = String(payload.status || "").trim();
    const reviewNote = String(payload.review_note || "").trim().slice(0, 1000) || null;
    if (!FEEDBACK_STATUSES.has(status)) return apiError("反馈状态无效。", 400);
    const service = serviceClient(env);
    const reviewed = status === "resolved" || status === "ignored";
    const { data, error } = await service.from("feedback").update({
      status,
      review_note: reviewNote,
      reviewed_by: admin.email,
      reviewed_at: reviewed ? new Date().toISOString() : null
    }).eq("feedback_no", params.feedbackNo).select("*").maybeSingle();
    if (error) throw error;
    if (!data) return apiError("反馈不存在。", 404);
    return json({ feedback: data });
  } catch (error) {
    return apiError(error.message === "FORBIDDEN" ? "无管理员权限。" : (error.message || "无法更新反馈。"), error.message === "FORBIDDEN" ? 403 : 500);
  }
}
