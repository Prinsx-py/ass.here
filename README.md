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
- Atomic IP rate-limiting on uploads (default 10/hour per IP) via a single Postgres RPC; uploads are refused with HTTP 503 if the rate-limit table is unreachable.
- Best-effort duplicate detection on the legacy `/api/upload` route (track + artist + duration).
- Written in Node.js (ESM) and deployed as Vercel serverless functions; Supabase (Postgres + Storage) is used for persistence.

## Quick API summary
All routes below live under `/api` and are deployed as Vercel serverless functions from `api/**.js`.

### Legacy routes (preferred — stable, used by the frontend)

- `GET /api/tracks?query=` — fuzzy search feed. Supports:
  - `query=` — space-separated keywords AND-matched against a denormalized `search_text` column (`track_name` + `artist_name` + `source_type`)
  - `has_karaoke_fx=1|true|yes|on` — limit to karaoke-timed files
  - `limit=` — default 50, max 100
  - `offset=` — pagination offset, default 0
- Example: `https://ass-here.vercel.app/api/tracks?query=Kundiman%20Silent%20Sanctuary`
- `POST /api/upload` — legacy upload. Validates `.ass`, enforces 200 KB cap, dedupes on track+artist+duration (409), SHA-256 hashed, IP rate-limited, writes a `search_text` column for the keyword matcher above.

### Versioned routes (`/api/v1/*`)

- `GET /api/v1/health` — health check (verifies Supabase connectivity)
- `GET /api/v1/search?q=&type=&synced=` — fuzzy search. If `synced=1` returns 0 hits, responds with `{ fallback: true, … }` and broader results.
- `GET /api/v1/get?title=&type=` — exact-match by title (optional `type` filter)
- `GET /api/v1/get/:id` — lookup by id
- `GET /api/v1/recent` — newest uploads (default 20, max 100)
- `GET /api/v1/raw/:id` — streams raw `.ass` text; falls back to a Supabase signed URL if the public fetch fails
- `POST /api/v1/upload` — JSON upload (`file_content` in body). Same `.ass` validation and IP rate-limit as the legacy route. Filenames are timestamp-prefixed and sanitized.

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
- Required schema lives in `migrations/`:
  - `migrations/001_add_content_hash.sql` — adds an optional `content_hash` column to `ass_tracks` for exact deduplication.
  - `migrations/002_upload_rate_limits.sql` — creates the `upload_rate_limits` table and the `consume_upload_quota(ip, limit, window_sec)` RPC consumed by `lib/rateLimit.js`. **Required**: the upload rate limiter is fail-closed when this migration is missing (returns HTTP 503), so apply it once per Supabase project.

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

The API is plain HTTPS + JSON; `fetch` (Node 18+) or `curl` is enough. There is no SDK to import. If you do want a self-hosted deployment rather than the public `ass.here` host:

```bash
export ASS_HERE_API_BASE=https://your-api-domain.com
```

See [CLIENT_SETUP.md Node.js Clients](CLIENT_SETUP.md#nodejs-clients) and [CLIENT_SETUP.md CLI Tools](CLIENT_SETUP.md#cli-tools).

---

## Testing
- Run `npm test` (Node ≥ 18 ships the built-in `node --test` runner; no extra deps).
- Coverage focuses on the pure-JS helpers in `lib/` (`validate.js`, `rateLimit.js`). End-to-end coverage of the API routes needs real Supabase credentials and is left manual:
  - With `vercel dev` running, hit `/api/v1/health`, `/api/v1/recent`, `/api/v1/search?q=…`, `/api/tracks?query=…`.
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

## ☕ Support the project

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/D4T221QPWW)