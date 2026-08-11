import { serviceClient } from "./billing.js";

function requestError(message, status) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  return error;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyTurnstile({ request, env, token, action }) {
  if (!env.TURNSTILE_SECRET_KEY) throw requestError("人机验证尚未配置，请联系管理员。", 503);
  if (!String(token || "").trim()) throw requestError("请先完成人机验证。", 400);

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: String(token).trim()
  });
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) body.set("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body
  });
  if (!response.ok) throw requestError("人机验证服务暂时不可用，请稍后重试。", 503);
  const result = await response.json();
  if (!result.success || (result.action && result.action !== action)) {
    throw requestError("人机验证未通过，请刷新后重试。", 400);
  }
}

export async function consumeRequestLimit({ request, env, action, subject = "", windowSeconds, limit }) {
  const remoteIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const fingerprint = await sha256Hex(
    `${env.SUPABASE_SERVICE_ROLE_KEY}:${action}:${remoteIp}:${String(subject).trim().toLowerCase()}`
  );
  const service = serviceClient(env);
  const { data, error } = await service.rpc("consume_request_limit", {
    p_action: action,
    p_request_fingerprint: fingerprint,
    p_window_seconds: windowSeconds,
    p_limit: limit
  });
  if (error) throw error;
  if (!data) throw requestError("提交过于频繁，请稍后再试。", 429);
}

export function publicRequestError(error, fallback, fallbackStatus = 500) {
  return {
    message: error.publicMessage || fallback,
    status: Number(error.status) || fallbackStatus
  };
}
