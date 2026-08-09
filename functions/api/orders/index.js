import { MEMBERSHIP_DAYS, MEMBERSHIP_PLAN, MEMBERSHIP_PRICE_CENTS, apiError, json, normalizeEmail, readJson, serviceClient } from "../../_shared/billing.js";

export async function onRequestPost({ request, env }) {
  try {
    const { email: inputEmail } = await readJson(request);
    const email = normalizeEmail(inputEmail);
    const service = serviceClient(env);
    const { data, error } = await service.rpc("create_purchase_order", { p_email: email });
    if (error) throw error;
    return json({ ...data, plan: MEMBERSHIP_PLAN, amount_cents: MEMBERSHIP_PRICE_CENTS, membership_days: MEMBERSHIP_DAYS });
  } catch (error) {
    return apiError(error.message || "无法创建订单。", 400);
  }
}
