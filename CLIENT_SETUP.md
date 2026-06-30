# Client Setup Guide for ass.here

This guide explains how to connect browser frontends, Node.js apps, and CLI tools to the ass.here API.

> **TL;DR** — The HTTP API is plain JSON over HTTPS. There is no client SDK; you call it with `fetch`, `curl`, or whatever your stack uses. The two things that matter for clients: (1) cookies/secrets aren't involved — reads are fully keyless, and (2) the browser frontend is pinned to its own origin on purpose.

---

## Table of Contents
1. [Overview](#overview)
2. [Browser Clients](#browser-clients)
3. [Node.js Clients](#nodejs-clients)
4. [CLI Tools](#cli-tools)
5. [Troubleshooting](#troubleshooting)

---

## Overview

ass.here keeps a clean split between frontend and backend clients:

### Browser Frontend (Public)
- **Cannot be reconfigured by users** — the API URL is the same origin the page was served from.
- Prevents DNS hijacking and social-engineered redirection to a malicious host.
- Deploy frontend + API on the same domain (Vercel, or any reverse proxy). Don't split them across origins.

### Server-Side Clients (CLI, Node.js)
- Plain `fetch` / `curl` against the API. No SDK, no auth header required for reads.
- For uploads, expect a JSON body with `file_content` (see [README → API summary](README.md#quick-api-summary)).

**Rule of thumb:** if the browser shows "API unreachable", it's a network or origin-mismatch problem, not configuration. The frontend has no configurable API URL to "fix".

---

## Browser Clients

### How the frontend resolves its API base

`index.html` and `search.html` use a constant `API_BASE = ''`. That means **same-origin** requests:

- Pages at `https://ass.here/` → call `https://ass.here/api/...`
- Pages at `https://my-custom-domain.com/` → call `https://my-custom-domain.com/api/...`

This is intentional: forbidding an in-page API URL stops a phishing page from repointing users at an attacker's server.

### Option 1: Same-domain deployment (recommended)

Host the static `index.html` and `search.html` next to the API. On Vercel this is automatic; elsewhere, just serve them from the same root.

### Option 2: Reverse proxy

If you have to run the frontend and API on separate hosts, put a proxy in front so paths unify:

```nginx
server {
  listen 443 ssl;
  server_name ass.here;

  # Static frontend
  location / {
    root /var/www/ass.here;
    try_files $uri /index.html;
  }

  # API requests → backend
  location /api/ {
    proxy_pass https://api-backend.internal/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Users see `https://ass.here/`, `/api/*` lands on your backend, and the frontend's `API_BASE = ''` keeps working.

### Option 3: Build-time API base (advanced)

If you really must put the frontend on a different origin, edit `index.html`/`search.html` and set

```html
<script>window.ASS_HERE_API_BASE = 'https://api.example.com';</script>
```

…before the inline `<script>`, then change the `const API_BASE = ''` lines to use `window.ASS_HERE_API_BASE || ''`. **Re-build before each deploy.** This loosens the security model above — make sure you understand it before doing it.

---

## Node.js Clients

Just use `fetch` (Node 18+) or `node-fetch`. There's no client library to import.

### Read example

```javascript
const base = process.env.ASS_HERE_API_BASE || 'https://ass.here';

async function searchTracks(query) {
  const url = `${base}/api/tracks?query=${encodeURIComponent(query)}&limit=20`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data || [];
}

const results = await searchTracks('Silent Sanctuary');
console.log(results);
```

### Upload example

```javascript
import fs from 'node:fs/promises';

const base = process.env.ASS_HERE_API_BASE || 'https://ass.here';
const file = await fs.readFile('./kundiman.ass', 'utf8');

const res = await fetch(`${base}/api/v1/upload`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    file_name: 'kundiman.ass',
    file_content: file,           // text body, ≤ 200 KB
    track_name: 'Kundiman',
    artist_name: 'Silent Sanctuary',
    source_type: 'Song',
    duration: 245.5,
    has_karaoke_fx: true
  })
});
const json = await res.json();
if (!res.ok) throw new Error(json.error || 'upload failed');
console.log('Uploaded:', json.data?.id, 'hash:', json.content_hash);
```

For higher upload throughput or to use the legacy `/api/upload` endpoint (which dedupes on track/artist/duration), see the [API summary](README.md#quick-api-summary).

### Tips
- **Timeout**: `AbortController` with a 10–15 s timeout is plenty for reads. Uploads can be larger, scale timeout to file size.
- **Retries**: don't retry non-idempotent upload bodies blindly; add `If-Match` semantics or a client-generated idempotency key if you need safe retries.
- **Rate limit**: uploads are IP-limited server-side (default 10/hour). One process per host is fine; multi-process scrapers should expect 429s.

---

## CLI Tools

```bash
# Read
curl 'https://ass.here/api/tracks?query=Silent%20Sanctuary'

# Custom API base (for self-hosted / staging)
ASS_BASE=https://ass.example.com
curl "$ASS_BASE/api/v1/health"

# Upload (file_content must be embedded as a string; not multipart)
ASS_CONTENT=$(jq -Rs '{file_name:"kundiman.ass", file_content:., track_name:"Kundiman",
  artist_name:"Silent Sanctuary", source_type:"Song", duration:245.5}' < kundiman.ass)
curl -X POST "$ASS_BASE/api/v1/upload" \
  -H 'Content-Type: application/json' \
  -d "$ASS_CONTENT"
```

### Shell alias

```bash
# ~/.bashrc or ~/.zshrc
alias ass='curl -s https://ass.here/api/tracks?query='
# Use:  ass "kundiman"
```

---

## Troubleshooting

### Browser: "API unreachable"

1. Are the API and frontend on the **same domain**? If not, set up a reverse proxy (above) or move one of them.
2. DNS: `nslookup your-domain.com` and `dig your-domain.com`
3. Health probe from the same machine the browser runs on: `curl https://your-domain.com/api/v1/health`
4. Browser DevTools → Network tab → check the request URL and CORS errors.

### Node/CLI: connection errors

1. `nslookup` / `dig` the API host.
2. Try `curl -v https://your-api/api/v1/health` to see the TLS chain.
3. Override the host with `ASS_HERE_API_BASE=https://...` if your tooling supports it.

### HTTP 429 (rate limit)

Uploads are capped at `UPLOAD_RATE_LIMIT` (default 10) per `UPLOAD_RATE_WINDOW` (default 3600s) per IP.
- Wait for the reset window.
- For multi-host integrations, contact the maintainers for a higher limit.

### HTTP 413 (file too large)

Server caps `.ass` uploads at 200 KB. Trim or split the file before retrying.

### HTTP 400 / 409 from upload

- 400 with `Invalid .ass file`: file is missing `[Script Info]`, `[V4+ Styles]`/`[V4 Styles]`, or `[Events]`.
- 409 from `/api/upload`: another row already has the same track/artist/duration. `/api/v1/upload` is non-deduping.

---

## Verifying Your Setup

```bash
nslookup ass.here
curl -I https://ass.here/api/v1/health
curl 'https://ass.here/api/v1/health'
curl 'https://ass.here/api/tracks?query=test'
```

For a self-hosted deployment, swap the host:

```bash
curl -I "$ASS_HERE_API_BASE/api/v1/health"
```

---

## Getting Help

1. Read [HOSTING.md](HOSTING.md) (if you're deploying the API)
2. Run the diagnostic commands above
3. Open an issue with: OS, Node.js version, command/output, and (without secrets) your config.
