import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'ass-files';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = String(req.query.query || '');
  let request = supabase.from('ass_tracks').select('*').order('created_at', { ascending: false });
  if (query) {
    request = request.or(`track_name.ilike.%${query}%,artist_name.ilike.%${query}%`);
  }

  const { data, error } = await request;
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ data });
}
