const { adminClient, findUserByEmail } = require("./shared");

const [email] = process.argv.slice(2);
if (!email) throw new Error("Usage: npm run member:revoke -- user@example.com");

async function main() {
  const supabase = adminClient();
  const user = await findUserByEmail(supabase, email);
  if (!user) throw new Error("Auth user not found.");
  const { error } = await supabase.from("memberships").update({ status: "revoked" }).eq("user_id", user.id);
  if (error) throw error;
  console.log(`Membership revoked for ${user.email}.`);
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
