import { getSupabaseClient } from '../../lib/supabase.js';

function parseBoolean(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function buildSearchRequest(supabase, { q, type, syncedFilter }) {
  let request = supabase
    .from('ass_tracks')
    .select('id,track_name,artist_name,source_type,duration,file_url,has_karaoke_fx,created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (q) {
    const safe = q.replace(/[(),*]/g, ' ');
    request = request.or(`track_name.ilike.%${safe}%,artist_name.ilike.%${safe}%`);
  }

  if (type) request = request.eq('source_type', type);
  if (typeof syncedFilter !== 'undefined') request = request.eq('has_karaoke_fx', syncedFilter);

  return request;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = String(req.query.q || '').trim();
  const type = String(req.query.type || '').trim();
  const synced = req.query.synced;
  const hasSyncedFilter = typeof synced !== 'undefined';
  const syncedValue = hasSyncedFilter ? parseBoolean(synced) : undefined;

  const supabaseResult = getSupabaseClient();
  if (supabaseResult.error) return res.status(500).json({ error: supabaseResult.error.message });
  const supabase = supabaseResult.client;

  try {
    const request = buildSearchRequest(supabase, { q, type, syncedFilter: syncedValue });
    const { data, error } = await request;
    if (error) return res.status(500).json({ error: error.message });

    if (hasSyncedFilter && syncedValue && (!data || data.length === 0)) {
      const fallbackRequest = buildSearchRequest(supabase, { q, type, syncedFilter: undefined });
      const { data: fallbackData, error: fallbackError } = await fallbackRequest;
      if (fallbackError) return res.status(500).json({ error: fallbackError.message });
      return res.json({
        data: fallbackData,
        fallback: true,
        fallbackReason: 'No synced results found; returned broader matching results without has_karaoke_fx filter',
        appliedFilters: { q: !!q, type: !!type, synced: syncedValue }
      });
    }

    return res.json({
      data,
      fallback: false,
      appliedFilters: { q: !!q, type: !!type, synced: hasSyncedFilter ? syncedValue : undefined }
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unexpected' });
  }
}
