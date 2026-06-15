import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'ass-files';

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { error: new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables') };
  }

  return {
    client: createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false }
    })
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseResult = getSupabaseClient();
  if (supabaseResult.error) {
    return res.status(500).json({ error: supabaseResult.error.message });
  }

  const supabase = supabaseResult.client;

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

  const hasKaraokeFx = ['true', '1', 'yes', 'on'].includes(String(hasKaraokeFxRaw).toLowerCase());
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

  const fileUrl = publicData.publicUrl;
  const { data: row, error: dbError } = await supabase.from('ass_tracks').insert([
    {
      track_name: trackName,
      artist_name: artistName,
      source_type: sourceType,
      duration: parseFloat(duration),
      has_karaoke_fx: hasKaraokeFx,
      file_url: fileUrl
    }
  ]);

  if (dbError) {
    return res.status(500).json({ error: dbError.message });
  }

  return res.status(201).json({ data: row?.[0] || null, fileUrl });
}
