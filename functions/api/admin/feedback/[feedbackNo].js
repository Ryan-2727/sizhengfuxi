import { apiError, json, readJson, requireAdmin, serviceClient } from "../../../_shared/billing.js";

const FEEDBACK_STATUSES = new Set(["new", "reviewing", "resolved", "ignored"]);
const RESOLUTION_KINDS = new Set(["fixed", "no_change", "needs_review"]);

export async function onRequestPatch({ request, env, params }) {
  try {
    const admin = await requireAdmin(request, env);
    const payload = await readJson(request);
    const status = String(payload.status || "").trim();
    const reviewNote = String(payload.review_note || "").trim().slice(0, 1000) || null;
    const resolutionKind = String(payload.resolution_kind || "").trim() || null;
    if (!FEEDBACK_STATUSES.has(status)) return apiError("反馈状态无效。", 400);
    if (resolutionKind && !RESOLUTION_KINDS.has(resolutionKind)) return apiError("反馈处理结论无效。", 400);
    if (resolutionKind && (!reviewNote || reviewNote.length < 5)) return apiError("请填写至少 5 个字的核验或修正依据。", 400);
    if (resolutionKind === "fixed" && status !== "resolved") return apiError("已修正反馈必须标记为已解决。", 400);
    if (resolutionKind === "no_change" && status !== "resolved") return apiError("无需修改反馈必须标记为已解决。", 400);
    if (resolutionKind === "needs_review" && status !== "reviewing") return apiError("待核验反馈必须保持处理中。", 400);
    const service = serviceClient(env);
    const { data: existing, error: existingError } = await service
      .from("feedback")
      .select("*")
      .eq("feedback_no", params.feedbackNo)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return apiError("反馈不存在。", 404);

    let resolvedRevisionId = null;
    let resolvedCatalogHash = null;
    if (resolutionKind === "needs_review") {
      if (!existing.question_database_id) return apiError("该反馈未关联数据库题目，无法进入题目核验队列。", 400);
      const { error: qualityError } = await service
        .from("question_quality")
        .update({ review_status: "needs_manual_review" })
        .eq("question_id", existing.question_database_id);
      if (qualityError) throw qualityError;
    }
    if (resolutionKind === "fixed") {
      if (!existing.question_database_id) return apiError("该反馈未关联数据库题目，不能标记为已修正。", 400);
      const { data: quality, error: qualityError } = await service
        .from("question_quality")
        .select("current_revision_id")
        .eq("question_id", existing.question_database_id)
        .maybeSingle();
      if (qualityError) throw qualityError;
      if (!quality?.current_revision_id) return apiError("该题尚无已发布修订，请先完成题库修订和质量同步。", 400);
      const reportedRevisionId = String(existing.context?.currentRevisionId || "").trim();
      if (reportedRevisionId && reportedRevisionId === quality.current_revision_id) {
        return apiError("当前修订与用户报错时相同，请先发布新的修订再标记为已修正。", 400);
      }
      resolvedRevisionId = quality.current_revision_id;
      const courseId = String(existing.context?.courseId || "").trim();
      if (!courseId) return apiError("反馈缺少课程标识，无法记录题库版本。", 400);
      const { data: catalog, error: catalogError } = await service
        .from("question_bank_catalog")
        .select("content_hash")
        .eq("course_id", courseId)
        .maybeSingle();
      if (catalogError) throw catalogError;
      if (!catalog?.content_hash) return apiError("课程题库版本不存在，请先同步题库目录。", 400);
      resolvedCatalogHash = catalog.content_hash;
    }
    const reviewed = status === "resolved" || status === "ignored";
    const { data, error } = await service.from("feedback").update({
      status,
      review_note: reviewNote,
      resolution_kind: status === "new" ? null : resolutionKind,
      resolved_revision_id: resolvedRevisionId,
      resolved_catalog_hash: resolvedCatalogHash,
      reviewed_by: admin.email,
      reviewed_at: reviewed ? new Date().toISOString() : null
    }).eq("feedback_no", params.feedbackNo).select("*").maybeSingle();
    if (error) throw error;
    return json({ feedback: data });
  } catch (error) {
    return apiError(error.message === "FORBIDDEN" ? "无管理员权限。" : (error.message || "无法更新反馈。"), error.message === "FORBIDDEN" ? 403 : 500);
  }
}
