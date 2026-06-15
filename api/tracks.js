import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.SUPABASE_API_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'ass-files';

function getSupabaseClient() {
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
    })
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseResult = getSupabaseClient();
  if (supabaseResult.error) {
    return res.status(500).json({ error: supabaseResult.error.message });
  }

  const supabase = supabaseResult.client;

  const query = String(req.query.query || '');
  const hasKaraokeRaw = req.query.has_karaoke_fx;
  const limit = Math.min(100, Number(req.query.limit || 50));
  const offset = Math.max(0, Number(req.query.offset || 0));

  let request = supabase.from('ass_tracks').select('*').order('created_at', { ascending: false });
  if (query) {
    request = request.or(`track_name.ilike.%${query}%,artist_name.ilike.%${query}%`);
  }

  if (typeof hasKaraokeRaw !== 'undefined') {
    const val = String(hasKaraokeRaw).toLowerCase();
    const bool = ['1', 'true', 'yes', 'on'].includes(val);
    request = request.eq('has_karaoke_fx', bool);
  }

  // apply pagination using range
  const start = offset;
  const end = offset + limit - 1;
  const { data, error } = await request.range(start, end);
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ data });
}
