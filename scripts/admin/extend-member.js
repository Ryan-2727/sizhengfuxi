const { adminClient, findUserByEmail, expiryFrom } = require("./shared");

const [email, expiry] = process.argv.slice(2);
if (!email || !expiry) throw new Error("Usage: npm run member:extend -- user@example.com 2026-12-31T23:59:59+08:00");

async function main() {
  const supabase = adminClient();
  const user = await findUserByEmail(supabase, email);
  if (!user) throw new Error("Auth user not found.");
  const { error } = await supabase.from("memberships").update({
    status: "active",
    expires_at: expiryFrom(expiry)
  }).eq("user_id", user.id);
  if (error) throw error;
  console.log(`Membership extended for ${user.email}.`);
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
