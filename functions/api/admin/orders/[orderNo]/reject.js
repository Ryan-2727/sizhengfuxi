import { apiError, json, orderPublicView, readJson, requireAdmin, serviceClient } from "../../../../_shared/billing.js";

export async function onRequestPost({ request, env, params }) {
  try {
    const admin = await requireAdmin(request, env);
    const body = await readJson(request);
    const service = serviceClient(env);
    const { data, error } = await service.rpc("reject_purchase_order", { p_order_no: params.orderNo, p_reviewed_by: admin.email, p_review_note: String(body.review_note || "").trim().slice(0, 500) || null });
    if (error) throw error;
    return json({ order: orderPublicView(data) });
  } catch (error) {
    const forbidden = error.message === "FORBIDDEN";
    return apiError(forbidden ? "无管理员权限。" : (error.message || "无法拒绝订单。"), forbidden ? 403 : 400);
  }
}
