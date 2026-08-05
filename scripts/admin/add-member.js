const { adminClient, findUserByEmail, expiryFrom } = require("./shared");

const [email, expiry] = process.argv.slice(2);
if (!email || !expiry) throw new Error("Usage: npm run member:add -- user@example.com 30");

async function main() {
  const supabase = adminClient();
  let user = await findUserByEmail(supabase, email);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    user = data.user;
  }
  const { error } = await supabase.from("memberships").upsert({
    user_id: user.id,
    email: user.email,
    status: "active",
    expires_at: expiryFrom(expiry)
  });
  if (error) throw error;
  console.log(`Active membership granted to ${user.email}.`);
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
