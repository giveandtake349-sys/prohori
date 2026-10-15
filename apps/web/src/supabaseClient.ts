import { createClient } from '@supabase/supabase-js';

// Supabase publishable keys are designed to be included in browser apps.
// Environment overrides are supported for local builds and future key rotation.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://okzgthxdkegwmttyyrvj.supabase.co';
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_eKmwgN3OVi6aDZqc1imSLA_roNkEzks';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export const API_BASE =
  import.meta.env.VITE_API_URL ?? 'https://prohori-api-m52n.onrender.com';
