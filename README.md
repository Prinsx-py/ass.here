# ass.here

ass.here is a community-driven registry for Advanced SubStation Alpha (`.ass`) subtitle files — a place to find, share, and download timed/subtitle files used for karaoke, fansubbing, and other synced-lyrics workflows.

This repository contains the frontend and serverless API used by the public site. The API is intentionally keyless for reads (public search/downloads) and rate-limited for uploads to reduce abuse.

## Who this is for
- Fansubbers, creators, and developers who want a simple, open index of `.ass` files.
- Developers who want a small, LRCLIB-like, versioned HTTP API to integrate synced lyric/subtitle files into players or services.

## Highlights
- Public, keyless read API for searching and downloading `.ass` files.
- Uploads accept `.ass` files with metadata (track, artist, source, duration, karaoke sync flag).
- Server-side validation rejects malformed `.ass` files and enforces a max file size.
- Best-effort duplicate detection (SHA-256 content hash) and IP-based rate limiting on uploads.
- Written in Node.js (ESM) and deployed as Vercel serverless functions; Supabase (Postgres + Storage) is used for persistence.

## Quick API summary
The project exposes a versioned API, but the legacy search route is the preferred working endpoint for track search in current deployments. If `/api/v1/search` is failing, use `/api/tracks?query=` instead.

- `GET /api/tracks?query=` — legacy tracks/search feed (preferred). Supports optional query modifiers:
  - `query=` — fuzzy search against `track_name` and `artist_name`
  - `has_karaoke_fx=1|true|yes|on` — limit results to tracks with karaoke timing data
  - `limit=` — maximum number of records returned (default 50, max 100)
  - `offset=` — pagination offset (default 0)
- `https://ass-here.vercel.app/api/tracks?query=Kundiman%20Silent%20Sanctuary` — example of query-based API call
- `GET /api/v1/health` — health check endpoint (verify API is running)
- `GET /api/v1/search?q=&type=&synced=` — fuzzy search (track/artist), optional `type` and `synced` filters
- `GET /api/v1/get?title=&type=` — exact-match lookup by title (and optional type)
- `GET /api/v1/get/:id` — lookup by id (returns metadata + stored fields)
- `GET /api/v1/recent` — recent uploads
- `GET /api/v1/top` — (placeholder) top/recent uploads
- `GET /api/v1/random` — random track
- `GET /api/v1/raw/:id` — returns raw `.ass` file content as plain text
- `POST /api/v1/upload` — v1 upload endpoint (metadata + `file_content`) — returns inserted record and `content_hash`

The existing legacy upload route remains for compatibility:

- `POST /api/upload` — (legacy) upload

See the source code in `api/` for implementation details.

## Upload expectations and rules
- File format: uploads must be valid `.ass` text files. The server validates that the file contains the required sections: `[Script Info]`, `[V4+ Styles]` or `[V4 Styles]`, and `[Events]`.
- Metadata: provide `track_name`, `artist_name`, `source_type` (e.g., "Anime" or "Song"), and `duration` (seconds). Also indicate `has_karaoke_fx` if syllable-level timing is present.
- Size limit: the server enforces a maximum file size (default 200 KB). Large files will be rejected with HTTP 413.
- Duplicate handling: a content SHA-256 is computed server-side. Exact duplicates are flagged; for robust dedup, the DB schema can be migrated to store `content_hash` (migration provided at `migrations/001_add_content_hash.sql`).
- Abuse protection: uploads are rate-limited by IP. If you need higher limits for integrations, contact the maintainers.

## Moderation & legal
- Uploaded files should respect copyright and redistribution rules. The site is a repository of user-contributed files — users are responsible for the content they upload.
- If you believe a file violates rights or is abusive, please open an issue or contact the maintainers so it can be removed.

## Development

Prerequisites: Node.js (recommended >= 18), `vercel` CLI for local development, and a Supabase project.

Environment: copy `.env.example` to `.env` and set the following variables (do not commit secrets):

- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SERVICE_KEY` — service role key for server operations (kept secret)
- `SUPABASE_BUCKET` — (optional) storage bucket name, default `ass-files`

Run locally using Vercel's local emulation (recommended):

```bash
npm install
vercel login
vercel dev
```

Notes:
- Local dev uses the same `api/*.js` handlers that run in production. We removed the older `server.local.js` to avoid drift — use `vercel dev` to emulate Vercel serverless functions locally.
- If you need to populate the DB schema (for rate limiter or `content_hash` column), run the SQL in `migrations/001_add_content_hash.sql` against your Supabase Postgres instance.

---

## Hosting & Deployment

ass.here is optimized for serverless deployment on **Vercel**, but can be deployed anywhere with Node.js support.

### For Operators / DevOps

See [**HOSTING.md**](HOSTING.md) for comprehensive deployment guides including:
- Deploying to Vercel (recommended)
- Deploying to other platforms (AWS, Azure, etc.)
- DNS configuration and troubleshooting
- SSL/TLS certificate setup
- Health checks and monitoring
- Common issues and how to fix them

**Key points:**
- Ensure your domain has valid DNS A/AAAA records pointing to your server
- Use HTTPS (all clients expect `https://` protocol)
- Configure environment variables securely (never commit secrets)
- Set up monitoring on the `/api/v1/health` endpoint

### Common Issues

**Problem:** "DNS resolution failed" or "API unreachable" errors

**Solution:** Check [HOSTING.md DNS Configuration](HOSTING.md#dns-configuration) section. Most commonly:
- DNS records not yet configured
- DNS records pointing to old server
- Waiting for DNS propagation (up to 48 hours)

Test with: `nslookup ass.here` or `dig ass.here`

---

## Client Setup & Configuration

ass.here provides **secure-by-default** clients:

### Browser Frontend (index.html / search.html)

⚠️ **Security:** The browser frontend uses a **fixed API endpoint** (same domain it's served from) to prevent DNS hijacking and social engineering. Users cannot change the API URL via the UI.

- **Deploy on same domain as API** (Vercel, traditional server)
- **Or use a reverse proxy** to combine frontend + backend on one domain
- See [CLIENT_SETUP.md Browser Clients](CLIENT_SETUP.md#browser-clients) for deployment options

### Server-Side Clients (CLI tools, Node.js apps)

Server-side tools can use flexible API configuration via environment variables:

```bash
export ASS_HERE_API_BASE=https://your-api-domain.com
export ASS_HERE_TIMEOUT=15000
export ASS_HERE_RETRY_COUNT=3
```

Uses `lib/api-config.js` for retry logic, fallbacks, and error handling.

See [CLIENT_SETUP.md Node.js Clients](CLIENT_SETUP.md#nodejs-clients) and [CLIENT_SETUP.md CLI Tools](CLIENT_SETUP.md#cli-tools).

---

## Diagnosis & Troubleshooting

### Verify API Connectivity

```bash
# Test DNS resolution
nslookup ass.here
dig ass.here

# Test HTTPS connectivity
curl -I https://ass.here/api/v1/health

# Test health endpoint
curl https://ass.here/api/v1/health

# Expected response (200 OK):
# { "status": "healthy", "message": "API is operational", ... }
```

### Check Logs

**Vercel:**
- Dashboard → Deployments → Logs

**Local development:**
- `vercel dev` shows logs in terminal

**Other platforms:**
- Check application logs / stdout

### Get Help

1. Read [HOSTING.md](HOSTING.md) (if you're deploying the API)
2. Read [CLIENT_SETUP.md](CLIENT_SETUP.md) (if you're using the API as a client)
3. Run diagnostic commands above
4. Open an issue on GitHub with diagnostics output and error messages

---

## Development

## Testing
- There are no automated tests yet. Recommended quick checks:
	- Start `vercel dev` and hit `/api/v1/recent` and `/api/v1/search?q=...`.
	- Upload a valid `.ass` via the frontend and verify the record appears in Supabase and the returned `content_hash` looks stable.

## Contributing
- Open issues for bugs or feature requests; use pull requests for code changes.
- Keep changes small and focused. If you propose DB schema changes (e.g. unique index on `content_hash`), describe migration and rollback steps in the PR.

## Repo structure (high level)
- `api/` — serverless route handlers for Vercel (production)
- `api/v1/` — versioned public API endpoints
- `lib/` — shared helpers (`supabase.js`, `validate.js`, `rateLimit.js`)
- `migrations/` — SQL migrations to be applied to Supabase
- `index.html`, `search.html` — frontend pages

## License
This repository is MIT licensed. See `LICENSE`.

## Contact / Issues
If you find a bug, privacy/security issue, or want a feature, please open an issue at the repository's Issues tab and include reproduction steps and relevant logs.

Thank you for helping build ass.here — contributions welcome.
