import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'ass-files';
const PORT = process.env.PORT || 3000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/tracks', async (req, res) => {
  const query = String(req.query.query || '');

  let request = supabase.from('ass_tracks').select('*').order('created_at', { ascending: false });
  if (query) {
    request = request.or(`track_name.ilike.%${query}%,artist_name.ilike.%${query}%`);
  }

  const { data, error } = await request;
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ data });
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Missing file upload' });
  }

  const trackName = String(req.body.track_name || '').trim();
  const artistName = String(req.body.artist_name || '').trim();
  const sourceType = String(req.body.source_type || '').trim();
  const duration = String(req.body.duration || '').trim();
  const hasKaraokeFxRaw = String(req.body.has_karaoke_fx || 'false').toLowerCase();
  const hasKaraokeFx = ['true', '1', 'yes', 'on'].includes(hasKaraokeFxRaw);

  if (!trackName || !artistName || !duration) {
    return res.status(400).json({ error: 'Track name, artist and duration are required' });
  }

  const fileExt = req.file.originalname.split('.').pop() || 'ass';
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`;

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(fileName, req.file.buffer, {
      cacheControl: '3600',
      contentType: req.file.mimetype,
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
});

app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Backend API listening on http://localhost:${PORT}`);
});
