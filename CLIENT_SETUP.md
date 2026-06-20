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

By default, all clients attempt to reach the API at `https://ass.here`. However, if:

- DNS resolution fails (domain not resolvable)
- The API is deployed to a different domain
- You're testing locally
- You want redundancy and fallbacks

...you need to configure an alternative API base URL.

### How Configuration Works

The ass.here client library supports configuration through multiple methods (in order of priority):

1. **Environment Variables** (highest priority)
   - `ASS_HERE_API_BASE` — Custom API base URL
   - `ASS_HERE_TIMEOUT` — Request timeout (milliseconds)
   - `ASS_HERE_RETRY_COUNT` — Number of retries

2. **Browser LocalStorage**
   - Set via: `apiConfig.setApiBase('https://your-api.com')`
   - Persists across page reloads

3. **Runtime Configuration**
   - Set programmatically in code

4. **Defaults**
   - Primary: `https://ass.here`
   - Fallbacks: `https://api.ass.here`

---

## Browser Clients

### Using the Frontend (index.html / search.html)

The HTML frontend automatically uses the API configuration system.

#### Option 1: Environment Variable (Build Time)

If you're building a static site:

```bash
# Set before building
export ASS_HERE_API_BASE="https://api.example.com"
npm run build  # or your build command
```

#### Option 2: LocalStorage (Runtime)

Open the browser console and run:

```javascript
// Set the API base for this browser
localStorage.setItem('ASS_HERE_API_BASE', 'https://api.example.com');

// Or use the helper
apiConfig.setApiBase('https://api.example.com');

// Verify
console.log(apiConfig.getApiBase());
```

This persists until you clear localStorage.

#### Option 3: Check the API Base

```javascript
// Check what API base is currently configured
console.log(apiConfig.getApiBase());

// Get all candidate URLs (primary + fallbacks)
console.log(apiConfig.getCandidateUrls());

// Test connectivity
apiConfig.fetch('/api/v1/health')
  .then(res => res.json())
  .then(data => console.log('API status:', data.status))
  .catch(err => console.error('API unreachable:', err.message));
```

---

## Node.js Clients

### Using the API Configuration Module

For Node.js applications and CLI tools:

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

If deploying a client in Docker:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy your client code
COPY . .

# Install dependencies
RUN npm install

# Set environment variable
ENV ASS_HERE_API_BASE=https://api.example.com

# Run your CLI tool or app
CMD ["node", "cli.js"]
```

Build and run:

```bash
docker build -t my-ass-client .
docker run -e ASS_HERE_API_BASE=https://api.example.com my-ass-client
```

---

## Troubleshooting

### Problem: "API unreachable" but API is running

**Diagnosis:**

```javascript
// Test DNS resolution
import dns from 'dns';
dns.resolve4('ass.here', (err, addresses) => {
  if (err) {
    console.error('DNS failed:', err.code);  // ENOTFOUND = not resolvable
  } else {
    console.log('DNS resolved to:', addresses);
  }
});

// Test connectivity
apiConfig.fetch('/api/v1/health')
  .then(res => res.json())
  .then(data => console.log('Status:', data.status))
  .catch(err => console.error('Connection error:', err.message));
```

**Solutions:**
1. Verify DNS: `nslookup ass.here` or `dig ass.here`
2. Set custom API base: `apiConfig.setApiBase('https://working-api.com')`
3. Check timeout: Increase `ASS_HERE_TIMEOUT` if network is slow
4. Increase retries: Set `ASS_HERE_RETRY_COUNT=5` for flaky networks

### Problem: "Timeout" errors on slow network

**Solutions:**

```bash
# Increase timeout to 30 seconds
export ASS_HERE_TIMEOUT=30000
your-cli-tool search "query"
```

Or in code:

```javascript
apiConfig.timeout = 30000;  // milliseconds
```

### Problem: "CORS" errors in browser

**Cause:** Browser blocking cross-origin requests

**Solutions:**
1. Use the same domain for API (best)
2. Check that API returns `Access-Control-Allow-Origin` header
3. API should already have CORS enabled (check `api/` handlers)

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

### 1. Use Health Check Before Making Requests

```javascript
// Only attempt searches if API is healthy
const healthCheck = await apiConfig.fetchJson('/api/v1/health');
if (healthCheck.status === 'healthy') {
  // Safe to make requests
}
```

### 2. Cache Results

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

### 3. Batch Requests

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

### 4. Handle Errors Gracefully

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

```bash
# Test 1: Check DNS resolution
nslookup ass.here

# Test 2: Test HTTPS connectivity
curl -I https://ass.here/api/v1/health

# Test 3: Test JSON response
curl https://ass.here/api/v1/health

# Test 4: Test search endpoint
curl 'https://ass.here/api/v1/search?q=test'

# Test 5: With custom API base
ASS_HERE_API_BASE=https://custom-api.com node -e "
  import('./lib/api-config.js').then(m => {
    console.log('API Base:', m.apiConfig.getApiBase());
  })
"
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
