import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.SUPABASE_API_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'ass-files';

export function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { error: new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables') };
  }

  try {
    new URL(SUPABASE_URL);
  } catch (err) {
    return { error: new Error('Invalid SUPABASE_URL environment variable. It must be a valid HTTP or HTTPS URL.') };
  }

  return {
    client: createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false }
    }),
    bucket: SUPABASE_BUCKET
  };
}
