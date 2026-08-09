import { apiError, ensureAuthUser, json, requireAdmin, serviceClient } from "../../../../_shared/billing.js";

export async function onRequestPost({ request, env, params }) {
  try {
    const admin = await requireAdmin(request, env);
    const service = serviceClient(env);
    const { data: order, error: orderError } = await service.from("orders").select("email, status").eq("order_no", params.orderNo).maybeSingle();
    if (orderError) throw orderError;
    if (!order) throw new Error("订单不存在。");
    if (order.status === "pending_review") await ensureAuthUser(service, order.email);
    const { data, error } = await service.rpc("approve_purchase_order", { p_order_no: params.orderNo, p_reviewed_by: admin.email });
    if (error) throw error;
    return json(data);
  } catch (error) {
    const forbidden = error.message === "FORBIDDEN";
    return apiError(forbidden ? "无管理员权限。" : (error.message || "无法开通会员。"), forbidden ? 403 : 400);
  }
}
