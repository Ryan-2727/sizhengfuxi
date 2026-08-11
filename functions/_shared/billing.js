import { createClient } from "@supabase/supabase-js";
import { MEMBERSHIP_DAYS, MEMBERSHIP_PLAN, MEMBERSHIP_PRICE_CENTS } from "../../src/billing-config.js";

export { MEMBERSHIP_DAYS, MEMBERSHIP_PLAN, MEMBERSHIP_PRICE_CENTS };

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export function apiError(message, status = 400) {
  return json({ error: message }, status);
}

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("请输入有效的邮箱地址。");
  return email;
}

export function serviceClient(env) {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((name) => !env[name]);
  if (missing.length) throw new Error(`服务器缺少环境变量：${missing.join(", ")}。`);
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function anonClient(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new Error("服务器未配置 Supabase 登录验证。");
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requestUser(request, env) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await anonClient(env).auth.getUser(token);
  if (error || !data.user?.email) return null;
  return { id: data.user.id, email: data.user.email.trim().toLowerCase() };
}

export async function requireAdmin(request, env) {
  const user = await requestUser(request, env);
  const admins = new Set(String(env.ADMIN_EMAILS || "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  if (!user || !admins.has(user.email)) throw new Error("FORBIDDEN");
  return user;
}

export async function readJson(request) {
  try { return await request.json(); } catch { throw new Error("请求内容无效。"); }
}

export function orderPublicView(order) {
  return {
    order_no: order.order_no,
    email: order.email,
    plan: order.plan,
    amount: Number(order.amount),
    membership_days: order.membership_days,
    payment_method: order.payment_method,
    payment_reference: order.payment_reference,
    status: order.status,
    created_at: order.created_at,
    submitted_at: order.submitted_at,
    reviewed_at: order.reviewed_at,
    review_note: order.review_note,
    membership_expires_at: order.membership_expires_at || null
  };
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readOrderForBuyer({ request, env, orderNo, accessToken = "" }) {
  const service = serviceClient(env);
  const { data: order, error } = await service.from("orders").select("*").eq("order_no", orderNo).maybeSingle();
  if (error) throw error;
  if (!order) return null;
  const user = await requestUser(request, env);
  const tokenMatches = accessToken && await sha256Hex(accessToken) === order.access_token_hash;
  if (!tokenMatches && user?.email !== order.email) return null;
  return order;
}

export async function ensureAuthUser(service, email) {
  const { error } = await service.auth.admin.createUser({ email, email_confirm: true });
  if (error && !/already (been )?registered|already exists|already been registered/i.test(error.message || "")) throw error;
}
