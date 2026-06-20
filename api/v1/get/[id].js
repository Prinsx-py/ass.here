import { getSupabaseClient } from '../../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const supabaseResult = getSupabaseClient();
  if (supabaseResult.error) return res.status(500).json({ error: supabaseResult.error.message });
  const supabase = supabaseResult.client;

  try {
    const { data, error } = await supabase.from('ass_tracks').select('*').eq('id', id).limit(1);
    if (error) return res.status(500).json({ error: error.message });
    if (!data || !data.length) return res.status(404).json({ error: 'Not found' });
    return res.json({ data: data[0] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unexpected' });
  }
}
