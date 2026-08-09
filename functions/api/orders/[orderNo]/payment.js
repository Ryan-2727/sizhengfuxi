import { apiError, json, orderPublicView, readJson, readOrderForBuyer, serviceClient } from "../../../_shared/billing.js";

export async function onRequestPost({ request, env, params }) {
  try {
    const body = await readJson(request);
    const order = await readOrderForBuyer({ request, env, orderNo: params.orderNo, accessToken: body.access_token || "" });
    if (!order) return apiError("订单不存在或无权操作。", 404);
    const service = serviceClient(env);
    const { data, error } = await service.rpc("submit_purchase_order", {
      p_order_no: order.order_no,
      p_payment_method: body.payment_method,
      p_payment_reference: String(body.payment_reference || "").trim()
    });
    if (error) throw error;
    return json({ order: orderPublicView(data) });
  } catch (error) {
    return apiError(error.message || "无法提交付款信息。", 400);
  }
}
