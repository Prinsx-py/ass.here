import { getSupabaseClient } from '../../../lib/supabase.js';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const supabaseResult = getSupabaseClient();
  if (supabaseResult.error) return res.status(500).json({ error: supabaseResult.error.message });
  const supabase = supabaseResult.client;

  try {
    const { data, error } = await supabase.from('ass_tracks').select('file_url').eq('id', id).limit(1);
    if (error) return res.status(500).json({ error: error.message });
    if (!data || !data.length) return res.status(404).json({ error: 'Not found' });
    const fileUrl = data[0].file_url;
    if (!fileUrl) return res.status(404).json({ error: 'File URL missing' });

    const resp = await fetch(fileUrl);
    if (!resp.ok) return res.status(502).json({ error: 'Failed to fetch file' });
    const text = await resp.text();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(text);
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unexpected' });
  }
}
