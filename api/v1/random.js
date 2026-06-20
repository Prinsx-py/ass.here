import { getSupabaseClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const supabaseResult = getSupabaseClient();
  if (supabaseResult.error) return res.status(500).json({ error: supabaseResult.error.message });
  const supabase = supabaseResult.client;

  try {
    const { data, error } = await supabase.rpc('random_ass_track');
    // Fallback to ordering by random if RPC not available
    if (error) {
      const { data: d2, error: e2 } = await supabase.from('ass_tracks').select('*').order('random()').limit(1);
      if (e2) return res.status(500).json({ error: e2.message });
      return res.json({ data: d2 });
    }
    return res.json({ data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unexpected' });
  }
}
