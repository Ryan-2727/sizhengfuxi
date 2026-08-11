import { apiError, json, requireAdmin, serviceClient } from "../../../_shared/billing.js";

const FEEDBACK_STATUSES = new Set(["new", "reviewing", "resolved", "ignored"]);

export async function onRequestGet({ request, env }) {
  try {
    await requireAdmin(request, env);
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "new";
    const query = (url.searchParams.get("q") || "").trim().replace(/[%_,()]/g, "").slice(0, 120);
    const service = serviceClient(env);
    let requestBuilder = service.from("feedback").select("*").order("created_at", { ascending: false }).limit(200);
    if (FEEDBACK_STATUSES.has(status)) requestBuilder = requestBuilder.eq("status", status);
    if (query) requestBuilder = requestBuilder.or(`feedback_no.ilike.%${query}%,content.ilike.%${query}%,user_email.ilike.%${query}%,contact.ilike.%${query}%`);
    const { data, error } = await requestBuilder;
    if (error) throw error;
    return json({ feedback: data || [] });
  } catch (error) {
    return apiError(error.message === "FORBIDDEN" ? "无管理员权限。" : (error.message || "无法读取反馈。"), error.message === "FORBIDDEN" ? 403 : 500);
  }
}
