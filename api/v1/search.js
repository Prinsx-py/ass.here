import { getSupabaseClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const q = String(req.query.q || '').trim();
  const type = String(req.query.type || '').trim();
  const synced = req.query.synced; // optional filter

  const supabaseResult = getSupabaseClient();
  if (supabaseResult.error) return res.status(500).json({ error: supabaseResult.error.message });
  const supabase = supabaseResult.client;

  try {
    let request = supabase.from('ass_tracks').select('*').order('created_at', { ascending: false }).limit(100);
    if (q) {
      const safe = q.replace(/[(),*]/g, ' ');
      request = request.or(`track_name.ilike.%${safe}%,artist_name.ilike.%${safe}%`);
    }
    if (type) request = request.eq('source_type', type);
    if (typeof synced !== 'undefined') {
      const val = String(synced).toLowerCase();
      const bool = ['1', 'true', 'yes', 'on'].includes(val);
      request = request.eq('has_karaoke_fx', bool);
    }

    const { data, error } = await request;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unexpected' });
  }
}
