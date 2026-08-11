import { MEMBERSHIP_DAYS, MEMBERSHIP_PLAN, MEMBERSHIP_PRICE_CENTS, apiError, json, normalizeEmail, readJson, serviceClient } from "../../_shared/billing.js";
import { consumeRequestLimit, publicRequestError, verifyTurnstile } from "../../_shared/public-request.js";

export async function onRequestPost({ request, env }) {
  try {
    const { email: inputEmail, turnstile_token: turnstileToken } = await readJson(request);
    const email = normalizeEmail(inputEmail);
    await verifyTurnstile({ request, env, token: turnstileToken, action: "create_order" });
    await consumeRequestLimit({
      request,
      env,
      action: "create_order",
      subject: email,
      windowSeconds: 3600,
      limit: 5
    });
    const service = serviceClient(env);
    const { data, error } = await service.rpc("create_purchase_order", { p_email: email });
    if (error) throw error;
    return json({ ...data, plan: MEMBERSHIP_PLAN, amount_cents: MEMBERSHIP_PRICE_CENTS, membership_days: MEMBERSHIP_DAYS });
  } catch (error) {
    const response = publicRequestError(error, error.message || "无法创建订单。", 400);
    return apiError(response.message, response.status);
  }
}
