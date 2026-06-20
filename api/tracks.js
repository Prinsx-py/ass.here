import { getSupabaseClient } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const supabaseResult = getSupabaseClient();
  if (supabaseResult.error) {
    return res.status(500).json({ error: supabaseResult.error.message });
  }

  const supabase = supabaseResult.client;

  let query = String(req.query.query || '');
  // sanitize query to avoid PostgREST filter injection
  query = query.replace(/[,\(\)\*]/g, ' ').trim();
  const hasKaraokeRaw = req.query.has_karaoke_fx;
  const limit = Math.min(100, Number(req.query.limit || 50));
  const offset = Math.max(0, Number(req.query.offset || 0));

  let request = supabase
  .from('ass_tracks')
  .select('*')
  .order('created_at', { ascending: false });

if (query) {
  const keywords = query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  keywords.forEach((k) => {
    request = request.ilike('search_text', `%${k}%`);
  });
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
