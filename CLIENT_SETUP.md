# Client Setup Guide for ass.here

This guide explains how to configure clients to connect to the ass.here API with robust error handling and fallback strategies.

## Table of Contents
1. [Overview](#overview)
2. [Browser Clients](#browser-clients)
3. [Node.js Clients](#nodejs-clients)
4. [CLI Tools](#cli-tools)
5. [Troubleshooting](#troubleshooting)

---

## Overview

ass.here provides **secure-by-default** clients with a clear separation between frontend and backend:

### Browser Frontend (Public)
- **Cannot be reconfigured by users** — connects to the domain it's served from
- Prevents DNS hijacking and social engineering attacks
- Deploy frontend + API on the same domain (Vercel, traditional server) or use a reverse proxy

### Server-Side Clients (CLI, Node.js)
- **Can be configured via environment variables** for flexible deployment
- Supports automatic retry, fallbacks, and timeout handling
- Use `lib/api-config.js` module

**Key Point:** If you see an error from the browser frontend saying the API is unreachable, it's likely a network/DNS issue, not a configuration problem. Check your internet connection and ensure your API is deployed correctly on the same domain.

---

## Browser Clients

### Using the Frontend (index.html / search.html)

The HTML frontend is designed for **public deployment** with a fixed API endpoint. It does NOT have user-configurable API settings to prevent DNS hijacking and other security issues.

#### How API URL is Determined

The frontend always uses the **same domain it was served from**:
- If you access `https://ass.here/`, it calls `https://ass.here/api/v1/*`
- If you access `https://my-custom-domain.com/`, it calls `https://my-custom-domain.com/api/v1/*`

This ensures users cannot be socially engineered into connecting to malicious servers.

#### Option 1: Deploy to Your API Domain (Recommended)

Host the static HTML files (`index.html`, `search.html`) on **the same domain** as your API:

```bash
# On Vercel:
# Deploy both frontend and API to the same project
# They'll share the same domain automatically

# On other platforms:
# Serve index.html and search.html from the same server as /api/
```

This is the simplest and most secure approach.

#### Option 2: Use a Reverse Proxy

If you need to serve the frontend separately, use a reverse proxy to combine them:

```nginx
# Nginx example
server {
  listen 443 ssl;
  server_name ass.here;

  # Serve static frontend files
  location / {
    root /var/www/ass.here;
    try_files $uri /index.html;
  }

  # Proxy API requests to backend server
  location /api/ {
    proxy_pass https://api-backend.internal/api/;
    proxy_set_header Host $host;
  }
}
```

Users accessing `https://ass.here/` see the frontend, and `/api/` requests go to your backend.

#### Option 3: Configure at Build Time (Advanced)

If using a build tool like Webpack/Vite, set API_BASE at build time:

```bash
# Build with custom API base
API_BASE=https://api.example.com npm run build
```

Then embed it in the bundled JavaScript. **Requires rebuilding for each deployment.**

---

## Node.js Clients

### Using the API Configuration Module

The `lib/api-config.js` module provides robust API client configuration **for server-side use only** (CLI tools, Node.js apps, backend services).

**Do NOT use this in browser code** — the browser frontend uses a fixed API endpoint for security.

```javascript
import apiConfig from './lib/api-config.js';

// Option 1: Set custom API base
apiConfig.setApiBase('https://api.example.com');

// Option 2: Use environment variable
process.env.ASS_HERE_API_BASE = 'https://api.example.com';

// Fetch from API with retry and timeout
try {
  const response = await apiConfig.fetch('/api/v1/search?q=test');
  const data = await response.json();
  console.log('Search results:', data);
} catch (err) {
  console.error('API error:', err.message);
  
  // Handle specific error types
  if (err.code === 'API_UNREACHABLE') {
    console.error('Tried these URLs:', err.candidates);
  }
}
```

### With Error Handling

```javascript
import apiConfig, { getErrorMessage } from './lib/api-config.js';

async function searchTracks(query) {
  try {
    const response = await apiConfig.fetchJson('/api/v1/search', {
      method: 'GET',
      // Add custom headers if needed
      headers: {
        'Accept': 'application/json'
      }
    });
    return response.data || [];
  } catch (err) {
    const userMessage = getErrorMessage(err);
    console.error('❌ ' + userMessage);
    throw err;
  }
}

searchTracks('Steins Gate')
  .then(results => console.log('Found:', results))
  .catch(err => {
    // Error already logged with user-friendly message
    process.exit(1);
  });
```

---

## CLI Tools

### terminal.lyrics.ass Example

If you're using a CLI tool like `terminal.lyrics.ass`, set the environment variable before running:

```bash
# Option 1: Set for a single command
ASS_HERE_API_BASE="https://api.example.com" your-cli-tool search "query"

# Option 2: Export for the session
export ASS_HERE_API_BASE="https://api.example.com"
your-cli-tool search "query"
your-cli-tool search "another query"
unset ASS_HERE_API_BASE  # Clear when done
```

### .env File Method

Create a `.env` file in your project:

```bash
# .env
ASS_HERE_API_BASE=https://api.example.com
ASS_HERE_TIMEOUT=15000
ASS_HERE_RETRY_COUNT=3
```

Then source it before running your tool:

```bash
source .env
your-cli-tool search "query"
```

### Shell Alias Method

Add to your `~/.bashrc` or `~/.zshrc`:

```bash
alias ass-cli='ASS_HERE_API_BASE=https://api.example.com your-cli-tool'

# Then use it like:
ass-cli search "query"
```

---

## Docker Deployment

If deploying a **server-side** client (CLI tool, Node.js service) in Docker:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy your client code
COPY . .

# Install dependencies
RUN npm install

# Set environment variable (for server-side tools only)
ENV ASS_HERE_API_BASE=https://api.example.com

# Run your CLI tool or app
CMD ["node", "cli.js"]
```

Build and run:

```bash
docker build -t my-ass-client .
docker run -e ASS_HERE_API_BASE=https://api.example.com my-ass-client
```

**Note:** The browser frontend does NOT use environment variables — it must be deployed on the same domain as the API.

---

## Troubleshooting

### Problem: Browser frontend says "API unreachable"

**Cause:** The API is not available on the same domain as the frontend

**Solutions:**
1. Check that your API is deployed and running
2. Verify DNS: `nslookup your-domain.com`
3. Test API health: `curl https://your-domain.com/api/v1/health`
4. Check internet connection
5. Review [HOSTING.md](HOSTING.md#dns-configuration) for DNS configuration issues

### Problem: Node.js/CLI tool says "API unreachable"

**Diagnostic:**

```javascript
// Test DNS resolution
import dns from 'dns';
dns.resolve4('your-api-domain.com', (err, addresses) => {
  if (err) {
    console.error('DNS failed:', err.code);  // ENOTFOUND = not resolvable
  } else {
    console.log('DNS resolved to:', addresses);
  }
});

// Test connectivity with apiConfig
import apiConfig from './lib/api-config.js';
apiConfig.fetchJson('/api/v1/health')
  .then(data => console.log('Status:', data.status))
  .catch(err => console.error('Connection error:', err.message));
```

**Solutions:**
1. Verify DNS: `nslookup your-api-domain.com` or `dig your-api-domain.com`
2. Set custom API base: `export ASS_HERE_API_BASE=https://working-api.com`
3. Check timeout: Increase `ASS_HERE_TIMEOUT=30000` if network is slow
4. Increase retries: Set `ASS_HERE_RETRY_COUNT=5` for flaky networks

### Problem: "Timeout" errors on slow network

**Solutions:**

```bash
# Increase timeout to 30 seconds (milliseconds)
export ASS_HERE_TIMEOUT=30000
your-cli-tool search "query"
```

Or in code:

```javascript
import apiConfig from './lib/api-config.js';
apiConfig.timeout = 30000;  // milliseconds
```

### Problem: "CORS" errors in browser

**Cause:** Browser blocking cross-origin requests

**Solutions:**
1. **Deploy frontend and API on same domain** (best)
   - Frontend should be served from the same domain as the API
   - Use Vercel, traditional server, or reverse proxy setup
2. Ensure your API returns correct CORS headers
   - Check that responses include `Access-Control-Allow-Origin: *`
   - ass.here API handlers should already have CORS enabled

### Problem: Rate limiting (HTTP 429)

**Cause:** Too many requests

**Solutions:**
1. Add delay between requests:
   ```javascript
   await new Promise(resolve => setTimeout(resolve, 100));  // 100ms delay
   ```
2. Reduce `ASS_HERE_RETRY_COUNT` to avoid retry storms
3. Cache results to avoid repeated requests
4. Contact maintainers for higher rate limits

---

## Performance Tips

### For Node.js / Server-Side Clients

#### 1. Use Health Check Before Making Requests

```javascript
// Only attempt searches if API is healthy
const healthCheck = await apiConfig.fetchJson('/api/v1/health');
if (healthCheck.status === 'healthy') {
  // Safe to make requests
}
```

#### 2. Cache Results

```javascript
const cache = new Map();

async function cachedSearch(query) {
  if (cache.has(query)) {
    return cache.get(query);
  }
  
  const results = await apiConfig.fetchJson(`/api/v1/search?q=${encodeURIComponent(query)}`);
  cache.set(query, results);
  
  return results;
}
```

#### 3. Batch Requests

Instead of:
```javascript
for (const query of queries) {
  await apiConfig.fetchJson(`/api/v1/search?q=${query}`);
}
```

Consider fetching in parallel (with reasonable limits):
```javascript
const results = await Promise.all(
  queries.map(q => apiConfig.fetchJson(`/api/v1/search?q=${q}`))
);
```

#### 4. Handle Errors Gracefully

```javascript
try {
  const results = await apiConfig.fetchJson('/api/v1/search?q=test');
  return results;
} catch (err) {
  console.warn('API failed, using fallback:', err.message);
  return getCachedResults() || [];  // Fallback to cache or defaults
}
```

---

## Verifying Your Setup

### For Browser Frontend

```bash
# Test 1: Check DNS resolution
nslookup ass.here

# Test 2: Test HTTPS connectivity
curl -I https://ass.here/api/v1/health

# Test 3: Test JSON response
curl https://ass.here/api/v1/health

# Test 4: Test search endpoint
curl 'https://ass.here/api/v1/search?q=test'
```

### For Server-Side Clients (Node.js / CLI)

```bash
# Test 1: Check DNS resolution
nslookup your-api-domain.com

# Test 2: Test API with custom base
ASS_HERE_API_BASE=https://your-api-domain.com node -e "
  import('./lib/api-config.js').then(m => {
    console.log('API Base:', m.apiConfig.getApiBase());
    return m.apiConfig.fetchJson('/api/v1/health');
  }).then(data => {
    console.log('Health:', data.status);
  }).catch(err => {
    console.error('Error:', err.message);
  })
"

# Test 3: Use your CLI tool
export ASS_HERE_API_BASE=https://your-api-domain.com
your-cli-tool search "query"
```

---

## Getting Help

If you continue to have issues:

1. Check the [HOSTING.md](HOSTING.md) guide for deployment issues
2. Run the diagnostic commands above
3. Check API logs on the server side
4. Open an issue on GitHub with:
   - OS and Node.js version
   - Output of diagnostic commands
   - Your configuration (without secrets)
   - Error message and stack trace
