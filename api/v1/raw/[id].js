import { getSupabaseClient } from '../../../lib/supabase.js';

function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function extractSupabasePath(publicUrl, bucket) {
  try {
    const url = new URL(publicUrl);
    const pattern = new RegExp(`/storage/v1/object/public/${bucket}/(.+)$`);
    const match = url.pathname.match(pattern);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const supabaseResult = getSupabaseClient();
  if (supabaseResult.error) return res.status(500).json({ error: supabaseResult.error.message });
  const supabase = supabaseResult.client;
  const bucket = supabaseResult.bucket;

  try {
    const { data, error } = await supabase.from('ass_tracks').select('file_url').eq('id', id).limit(1);
    if (error) return res.status(500).json({ error: error.message });
    if (!data || !data.length) return res.status(404).json({ error: 'Track not found' });

    const fileUrl = data[0].file_url;
    if (!fileUrl) return res.status(404).json({ error: 'File URL missing' });
    if (!isValidUrl(fileUrl)) return res.status(502).json({ error: 'Invalid file_url stored in database' });

    const fetchFile = async (url) => {
      const response = await globalThis.fetch(url);
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(`${response.status} ${response.statusText}${bodyText ? `: ${bodyText}` : ''}`);
      }
      return response.text();
    };

    try {
      const text = await fetchFile(fileUrl);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(text);
    } catch (networkError) {
      const supabasePath = extractSupabasePath(fileUrl, bucket);
      if (supabasePath) {
        const { data: signedData, error: signedUrlError } = await supabase.storage.from(bucket).createSignedUrl(supabasePath, 60);
        if (!signedUrlError && signedData?.signedUrl) {
          try {
            const signedText = await fetchFile(signedData.signedUrl);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.send(signedText);
          } catch (signedError) {
            return res.status(502).json({
              error: 'Failed to fetch file from signed URL',
              details: signedError.message,
              originalFileUrl: fileUrl
            });
          }
        }
      }

      return res.status(502).json({
        error: 'Failed to fetch file',
        details: networkError.message,
        file_url: fileUrl
      });
    }
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unexpected' });
  }
}
