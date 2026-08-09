import { apiError, json, orderPublicView, readOrderForBuyer } from "../../_shared/billing.js";

export async function onRequestGet({ request, env, params }) {
  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    const order = await readOrderForBuyer({ request, env, orderNo: params.orderNo, accessToken: token });
    if (!order) return apiError("订单不存在或无权查看。", 404);
    return json({ order: orderPublicView(order) });
  } catch (error) {
    return apiError(error.message || "无法读取订单。", 500);
  }
}
