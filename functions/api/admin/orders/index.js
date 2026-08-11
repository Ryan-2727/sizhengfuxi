import { apiError, json, orderPublicView, requireAdmin, serviceClient } from "../../../_shared/billing.js";

export async function onRequestGet({ request, env }) {
  try {
    await requireAdmin(request, env);
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "pending_review";
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    const service = serviceClient(env);
    let requestBuilder = service.from("orders").select("*").order("created_at", { ascending: false }).limit(200);
    if (["pending_review", "approved", "rejected"].includes(status)) requestBuilder = requestBuilder.eq("status", status);
    if (query) requestBuilder = requestBuilder.or(`email.ilike.%${query.replace(/[%_,()]/g, "")}%,order_no.ilike.%${query.replace(/[%_,()]/g, "")}%`);
    const { data, error } = await requestBuilder;
    if (error) throw error;
    return json({ orders: (data || []).map(orderPublicView) });
  } catch (error) {
    return apiError(error.message === "FORBIDDEN" ? "无管理员权限。" : (error.message || "无法读取订单。"), error.message === "FORBIDDEN" ? 403 : 500);
  }
}
