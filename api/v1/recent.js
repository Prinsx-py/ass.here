import { getSupabaseClient } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const limit = Math.min(100, Number(req.query.limit || 20));
  const supabaseResult = getSupabaseClient();
  if (supabaseResult.error) return res.status(500).json({ error: supabaseResult.error.message });
  const supabase = supabaseResult.client;

  const { data, error } = await supabase.from('ass_tracks').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data });
}
