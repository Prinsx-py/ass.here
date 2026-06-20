import { getSupabaseClient } from '../../lib/supabase.js';

// GET /api/v1/get?title=&episode=&type=
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const title = String(req.query.title || '').trim();
  const type = String(req.query.type || '').trim();

  const supabaseResult = getSupabaseClient();
  if (supabaseResult.error) return res.status(500).json({ error: supabaseResult.error.message });
  const supabase = supabaseResult.client;

  try {
    if (!title) return res.status(400).json({ error: 'title parameter required' });
    let request = supabase.from('ass_tracks').select('*').eq('track_name', title).limit(20);
    if (type) request = request.eq('source_type', type);
    const { data, error } = await request;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unexpected' });
  }
}
