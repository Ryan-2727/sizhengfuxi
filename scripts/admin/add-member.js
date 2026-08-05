const { adminClient, findUserByEmail, expiryFrom } = require("./shared");

const [email, expiry] = process.argv.slice(2);
const ACTIVE_MEMBER_LIMIT = 300;
if (!email || !expiry) throw new Error("Usage: npm run member:add -- user@example.com 30");

async function main() {
  const supabase = adminClient();
  let user = await findUserByEmail(supabase, email);
  const { data: existingMembership, error: membershipError } = user
    ? await supabase.from("memberships").select("status, expires_at").eq("user_id", user.id).maybeSingle()
    : { data: null, error: null };
  if (membershipError) throw membershipError;
  const alreadyActive = existingMembership?.status === "active"
    && Date.parse(existingMembership.expires_at) > Date.now();
  if (!alreadyActive) {
    const { count, error: countError } = await supabase
      .from("memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString());
    if (countError) throw countError;
    if ((count || 0) >= ACTIVE_MEMBER_LIMIT) {
      throw new Error(`Active member limit (${ACTIVE_MEMBER_LIMIT}) reached. Check Supabase Usage before opening another membership.`);
    }
  }
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
