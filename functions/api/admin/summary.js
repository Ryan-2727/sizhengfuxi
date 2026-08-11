import { apiError, json, requireAdmin, serviceClient } from "../../_shared/billing.js";

export async function onRequestGet({ request, env }) {
  try {
    await requireAdmin(request, env);
    const service = serviceClient(env);
    const [ordersResult, feedbackResult] = await Promise.all([
      service.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
      service.from("feedback").select("id", { count: "exact", head: true }).in("status", ["new", "reviewing"])
    ]);
    if (ordersResult.error) throw ordersResult.error;
    if (feedbackResult.error) throw feedbackResult.error;
    return json({
      pending_orders: ordersResult.count || 0,
      open_feedback: feedbackResult.count || 0
    });
  } catch (error) {
    const forbidden = error.message === "FORBIDDEN";
    return apiError(forbidden ? "无管理员权限。" : (error.message || "无法读取管理员待办。"), forbidden ? 403 : 500);
  }
}
