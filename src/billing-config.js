// Shared by the browser UI and Cloudflare Pages Functions. Database checks in
// the migration mirror these fixed values to prevent client-side tampering.
export const MEMBERSHIP_PLAN = "monthly";
export const MEMBERSHIP_PRICE_CENTS = 990;
export const MEMBERSHIP_PRICE = MEMBERSHIP_PRICE_CENTS / 100;
export const MEMBERSHIP_DAYS = 30;

export function membershipPriceLabel() {
  return `¥${MEMBERSHIP_PRICE.toFixed(2)}`;
}
