import { createClient } from "@supabase/supabase-js";

const url = __SUPABASE_URL__;
const anonKey = __SUPABASE_ANON_KEY__;

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    })
  : null;
