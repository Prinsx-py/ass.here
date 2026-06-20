import { getSupabaseClient } from '../../lib/supabase.js';
import { validateAssContent, computeSHA256 } from '../../lib/validate.js';
import { checkRateLimit } from '../../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseResult = getSupabaseClient();
  if (supabaseResult.error) return res.status(500).json({ error: supabaseResult.error.message });
  const supabase = supabaseResult.client;
  const SUPABASE_BUCKET = supabaseResult.bucket;

  const remoteIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const rate = await checkRateLimit(supabase, remoteIp);
  if (!rate.ok) return res.status(429).json({ error: 'Rate limit exceeded', details: rate });

  const { file_name: fileName, file_content: fileContent, content_type: contentType, track_name: trackName, artist_name: artistName, source_type: sourceType, duration, has_karaoke_fx } = req.body || {};
  if (!fileName || !fileContent || !trackName || !artistName || !duration) return res.status(400).json({ error: 'Missing required fields' });

  const { valid, errors } = validateAssContent(fileContent);
  if (!valid) return res.status(400).json({ error: 'Invalid .ass file', details: errors });

  const contentHash = computeSHA256(fileContent);

  const buffer = Buffer.from(fileContent, 'utf8');
  const uniqueFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { data: uploadData, error: uploadError } = await supabase.storage.from(SUPABASE_BUCKET).upload(uniqueFileName, buffer, { cacheControl: '3600', contentType: contentType || 'text/plain', upsert: false });
  if (uploadError) return res.status(500).json({ error: uploadError.message });

  const { data: publicData, error: publicUrlError } = await supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(uniqueFileName);
  if (publicUrlError || !publicData?.publicUrl) return res.status(500).json({ error: publicUrlError?.message || 'Could not obtain public URL' });

  const fileUrl = publicData.publicUrl;
  const { data: row, error: dbError } = await supabase.from('ass_tracks').insert([{ track_name: trackName, artist_name: artistName, source_type: sourceType, duration: parseFloat(duration), has_karaoke_fx: !!has_karaoke_fx, file_url: fileUrl }]).select();
  if (dbError) return res.status(500).json({ error: dbError.message });

  return res.status(201).json({ data: row?.[0] || null, fileUrl, content_hash: contentHash });
}
