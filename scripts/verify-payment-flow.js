const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/migrations/202608090006_purchase_orders.sql");
const app = read("app.js");
const orderApi = read("functions/api/orders/index.js");
const paymentApi = read("functions/api/orders/[orderNo]/payment.js");
const approveApi = read("functions/api/admin/orders/[orderNo]/approve.js");
const helper = read("functions/_shared/billing.js");

assert(/create table if not exists public\.orders/i.test(migration), "orders table migration is missing.");
assert(/order_no text not null unique/i.test(migration), "orders must have a unique public order number.");
assert(/access_token_hash text not null/i.test(migration), "pre-login orders need a hashed access token.");
assert(/status in \('pending_payment', 'pending_review', 'approved', 'rejected'\)/i.test(migration), "order status contract is incomplete.");
assert(/alter table public\.orders enable row level security/i.test(migration), "orders RLS is missing.");
assert(/revoke all on table public\.orders from anon, authenticated/i.test(migration), "browser roles must not have direct order access.");
assert(/grant all on table public\.orders to service_role/i.test(migration), "service role must be able to process orders.");
assert(/current_order\.status not in \('pending_payment', 'rejected'\)/i.test(migration), "payment submission must not approve an order.");
assert(/status = 'pending_review'/i.test(migration), "payment submission must move only to pending_review.");
assert(/current_order\.status = 'approved'/i.test(migration), "approval must be idempotent.");
assert(/current_order\.status <> 'pending_review'/i.test(migration), "approval must require pending_review.");
assert(/membership\.expires_at > now\(\)/i.test(migration), "active memberships must retain remaining time.");
assert(/membership\.expires_at \+ make_interval\(days => current_order\.membership_days\)/i.test(migration), "renewal must extend from the existing expiry.");
assert(/now\(\) \+ make_interval\(days => current_order\.membership_days\)/i.test(migration), "new or expired members must extend from server time.");
assert(/update public\.orders\s+set status = 'approved'/i.test(migration), "approval must mark the order after membership handling.");
assert(/revoke all on function public\.approve_purchase_order/i.test(migration), "approval RPC must not be browser-callable.");
assert(/requireAdmin\(/.test(approveApi) && /SUPABASE_SERVICE_ROLE_KEY/.test(helper), "admin approval must run in a protected server function.");
assert(/readOrderForBuyer/.test(paymentApi), "payment submission must check order ownership or access token.");
assert(!/ensureAuthUser/.test(orderApi), "an unpaid order must not create an Auth user.");
assert(/ensureAuthUser/.test(approveApi), "approved orders must provision the existing OTP identity server-side.");
assert(/membershipPriceLabel/.test(app) && /MEMBERSHIP_DAYS/.test(app), "browser price and duration must use shared billing configuration.");
assert(!/status:\s*["']approved/.test(app), "browser code must not create approved orders.");
assert(!/from\(["']memberships["']\)\.insert|from\(["']memberships["']\)\.update/.test(app), "browser code must not write memberships.");
assert(/\/api\/admin\/orders/.test(app), "admin UI must use protected APIs.");
console.log("Payment membership static contract passed.");
