import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from './lib/supabase.js';
import { validateAssContent } from './lib/validate.js';
import { checkRateLimit } from './lib/rateLimit.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.MAX_ASS_SIZE || 200 * 1024) } });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: true }));

const supabaseResult = getSupabaseClient();
if (supabaseResult.error) {
  console.error(supabaseResult.error.message);
  process.exit(1);
}
const supabase = supabaseResult.client;
const SUPABASE_BUCKET = supabaseResult.bucket;

app.get('/api/tracks', async (req, res) => {
  try {
    let query = String(req.query.query || '');
    query = query.replace(/[,\(\)\*]/g, ' ').trim();

    let request = supabase.from('ass_tracks').select('*').order('created_at', { ascending: false });
    if (query) {
      request = request.or(`track_name.ilike.%${query}%,artist_name.ilike.%${query}%`);
    }

    const { data, error } = await request;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  } catch (err) {
    console.error('Tracks handler failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Accept either multipart/form-data (local form) OR JSON body with file_content
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const remoteIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const rate = await checkRateLimit(supabase, remoteIp);
    if (!rate.ok) {
      return res.status(429).json({ error: 'Rate limit exceeded', details: rate });
    }

    let fileContent = null;
    let fileName = null;
    let contentType = 'text/plain';
    // prefer JSON body with file_content
    if (req.body && req.body.file_content) {
      fileContent = String(req.body.file_content || '');
      fileName = String(req.body.file_name || `${Date.now()}.ass`);
      contentType = String(req.body.content_type || 'text/plain');
    } else if (req.file) {
      fileContent = req.file.buffer.toString('utf8');
      fileName = req.file.originalname || `${Date.now()}.ass`;
      contentType = req.file.mimetype || 'text/plain';
    } else {
      return res.status(400).json({ error: 'Missing file upload or file_content in JSON body' });
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

    // validate .ass sections
    const { valid, errors } = validateAssContent(fileContent);
    if (!valid) return res.status(400).json({ error: 'Invalid .ass file', details: errors });

    // store file
    const buffer = Buffer.from(fileContent, 'utf-8');
    const uniqueFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(uniqueFileName, buffer, {
        cacheControl: '3600',
        contentType: contentType || 'text/plain',
        upsert: false
      });

    if (uploadError) {
      return res.status(500).json({ error: uploadError.message });
    }

    const { data: publicData, error: publicUrlError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(uniqueFileName);

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
    ]).select();

    if (dbError) {
      return res.status(500).json({ error: dbError.message });
    }

    return res.status(201).json({ data: row?.[0] || null, fileUrl });
  } catch (err) {
    console.error('Upload handler failed:', err);
    return res.status(500).json({ error: err.message });
  }
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
