import { apiError, json, requireAdmin, serviceClient } from "../../../_shared/billing.js";

const MEMBER_FILTERS = new Set(["active", "expired", "revoked", "all"]);

export async function onRequestGet({ request, env }) {
  try {
    await requireAdmin(request, env);
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "active";
    const query = (url.searchParams.get("q") || "").trim().replace(/[%_,()]/g, "").slice(0, 120);
    const now = new Date().toISOString();
    const service = serviceClient(env);
    let requestBuilder = service
      .from("memberships")
      .select("email, status, expires_at, created_at, updated_at", { count: "exact" })
      .order("expires_at", { ascending: false })
      .limit(1000);

    if (status === "active") requestBuilder = requestBuilder.eq("status", "active").gt("expires_at", now);
    else if (status === "expired") requestBuilder = requestBuilder.eq("status", "active").lte("expires_at", now);
    else if (status === "revoked") requestBuilder = requestBuilder.eq("status", "revoked");
    else if (!MEMBER_FILTERS.has(status)) return apiError("会员状态筛选无效。", 400);
    if (query) requestBuilder = requestBuilder.ilike("email", `%${query}%`);

    const { data, error, count } = await requestBuilder;
    if (error) throw error;
    return json({ members: data || [], total: count || 0 });
  } catch (error) {
    const forbidden = error.message === "FORBIDDEN";
    return apiError(forbidden ? "无管理员权限。" : (error.message || "无法读取会员列表。"), forbidden ? 403 : 500);
  }
}
