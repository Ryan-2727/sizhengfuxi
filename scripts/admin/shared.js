const { createClient } = require("@supabase/supabase-js");

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

async function findUserByEmail(supabase, email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
}

function expiryFrom(value) {
  if (!value) throw new Error("An expiry date or number of days is required.");
  if (/^\d+$/.test(value)) {
    return new Date(Date.now() + Number(value) * 24 * 60 * 60 * 1000).toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expiry must be an ISO date or a number of days.");
  return date.toISOString();
}

module.exports = { adminClient, findUserByEmail, expiryFrom };
