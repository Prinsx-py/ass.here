import { getSupabaseClient } from '../lib/supabase.js';
import { validateAssContent, MAX_ASS_SIZE, computeSHA256 } from '../lib/validate.js';
import { checkRateLimit } from '../lib/rateLimit.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const supabaseResult = getSupabaseClient();
    if (supabaseResult.error) {
      return res.status(500).json({ error: supabaseResult.error.message });
    }

    const supabase = supabaseResult.client;
    const SUPABASE_BUCKET = supabaseResult.bucket;

    // Rate limiting (IP-based)
    const remoteIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const rate = await checkRateLimit(supabase, remoteIp);
    if (!rate.ok) {
      return res.status(429).json({ error: 'Rate limit exceeded', details: rate });
    }

    const {
      file_name: fileName,
      file_content: fileContent,
      content_type: contentType,
      track_name: trackName,
      artist_name: artistName,
      source_type: sourceType,
      duration,
      has_karaoke_fx: hasKaraokeFxRaw
    } = req.body || {};

    if (!fileName || !fileContent || !trackName || !artistName || !duration) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // enforce max file size
    if (Buffer.byteLength(String(fileContent || ''), 'utf8') > MAX_ASS_SIZE) {
      return res.status(413).json({ error: `File too large. Max size ${MAX_ASS_SIZE} bytes` });
    }

    // basic .ass validation
    const { valid, errors } = validateAssContent(fileContent);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid .ass file', details: errors });
    }

    const hasKaraokeFx = ['true', '1', 'yes', 'on'].includes(String(hasKaraokeFxRaw).toLowerCase());

    // compute content hash for duplicate detection
    const contentHash = computeSHA256(fileContent);

    // Best-effort duplicate detection: try to find an existing row with same track/artist/duration
    try {
      const dupQ = supabase.from('ass_tracks').select('id,file_url,track_name,artist_name').eq('track_name', trackName).eq('artist_name', artistName).eq('duration', parseFloat(duration)).limit(1);
      const { data: dupData, error: dupErr } = await dupQ;
      if (dupErr) console.warn('Duplicate check query error:', dupErr.message);
      if (dupData && dupData.length) {
        return res.status(409).json({ error: 'Duplicate upload detected (matching track/artist/duration)', existing: dupData[0], content_hash: contentHash });
      }
    } catch (e) {
      console.warn('Duplicate detection failed:', e?.message || e);
    }

    const buffer = Buffer.from(fileContent, 'utf-8');

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(fileName, buffer, {
        cacheControl: '3600',
        contentType: contentType || 'text/plain',
        upsert: false
      });

    if (uploadError) {
      return res.status(500).json({ error: uploadError.message });
    }

    const { data: publicData, error: publicUrlError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(fileName);

    if (publicUrlError || !publicData?.publicUrl) {
      return res.status(500).json({ error: publicUrlError?.message || 'Could not obtain public URL' });
    }

    function buildSearchText(track, artist, sourceType) {
      return [
        track,
        artist,
        sourceType
      ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    }
    
    const search_text = buildSearchText(trackName, artistName, sourceType);

    const fileUrl = publicData.publicUrl;
    const { data: row, error: dbError } = await supabase.from('ass_tracks').insert([
      {
        track_name: trackName,
        artist_name: artistName,
        source_type: sourceType,
        duration: parseFloat(duration),
        has_karaoke_fx: hasKaraokeFx,
        file_url: fileUrl,
        search_text
      }
    ]).select();

    if (dbError) {
      return res.status(500).json({ error: dbError.message });
    }

    // return the new row plus content hash for the client to check
    return res.status(201).json({ data: row?.[0] || null, fileUrl, content_hash: contentHash });
  } catch (error) {
    console.error('Upload handler failed:', error);
    return res.status(500).json({ error: error?.message || 'Unexpected error in upload handler' });
  }
}
