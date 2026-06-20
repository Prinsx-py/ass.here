# Hosting & Deployment Guide for ass.here

This guide explains how to deploy ass.here to production and ensure it's properly accessible to clients.

## Table of Contents
1. [Deployment Platforms](#deployment-platforms)
2. [DNS Configuration](#dns-configuration)
3. [Environment Setup](#environment-setup)
4. [Health Checks](#health-checks)
5. [Troubleshooting](#troubleshooting)

---

## Deployment Platforms

### Vercel (Recommended)

Vercel is the easiest option for serverless deployment and is what ass.here is optimized for.

#### Setup Steps

1. **Create a Vercel Account**
   - Go to [vercel.com](https://vercel.com)
   - Sign up or log in with GitHub

2. **Connect Your Repository**
   - Click "New Project"
   - Import the ass.here repository from GitHub
   - Select the repository

3. **Configure Environment Variables**
   - In Project Settings → Environment Variables, add:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_KEY`
     - `SUPABASE_BUCKET` (optional, default: `ass-files`)
   - **Do NOT commit these to version control**

4. **Deploy**
   - Vercel auto-deploys on git push to main
   - Your API will be available at `https://[project-name].vercel.app`

5. **Configure Custom Domain** (see [DNS Configuration](#dns-configuration) below)

### Other Platforms

If deploying elsewhere (AWS, Azure, Heroku, etc.):

1. Install dependencies: `npm install`
2. Ensure Node.js >= 18 is available
3. Set environment variables for your platform
4. Configure the API base URL in clients (see [CLIENT_SETUP.md](CLIENT_SETUP.md))
5. Start the dev server: `npm run dev` or `npm start`

---

## DNS Configuration

### Understanding the Problem

The most common issue with ass.here is **DNS resolution failure**. This happens when:

- The domain (e.g., `ass.here`) has no valid DNS A/AAAA records
- DNS records point to an outdated server
- DNS records are misconfigured
- The domain registrar's nameservers are not set correctly

When clients try to connect to `https://ass.here/api/v1/search`, they first perform a DNS lookup. If it fails, the entire request fails before reaching your server.

### Configuring DNS Records

#### If Using Vercel

1. **Option A: Vercel Nameservers (Recommended)**
   - In Vercel Project Settings → Domains
   - Add your domain (e.g., `ass.here`)
   - Vercel will provide 4 nameservers
   - In your domain registrar, update the nameservers to Vercel's
   - Propagation takes 5 minutes to 48 hours

2. **Option B: CNAME Record (Faster)**
   - In your domain registrar, create a CNAME record:
     ```
     Name: ass.here (or your subdomain)
     Type: CNAME
     Value: [project-name].vercel.app
     ```
   - Or for www subdomain:
     ```
     Name: www
     Type: CNAME
     Value: [project-name].vercel.app
     ```

3. **Verify Configuration**
   - Run: `nslookup ass.here` (macOS/Linux/Windows)
   - Should return an IP address pointing to Vercel's infrastructure
   - If it returns "NXDOMAIN" or "ENOTFOUND", DNS is not yet configured

#### If Using Another Platform

Create DNS A records pointing to your server's IP address:

```
Name: ass.here
Type: A
Value: YOUR_SERVER_IP_ADDRESS
TTL: 3600
```

For IPv6 support, also add:

```
Name: ass.here
Type: AAAA
Value: YOUR_SERVER_IPV6_ADDRESS
TTL: 3600
```

### SSL/TLS Certificate

**Important:** All clients expect HTTPS (`https://ass.here`), not HTTP.

- **Vercel**: Automatically provisions and renews SSL certificates
- **Other platforms**: Use Let's Encrypt (free) or purchase a certificate
  - Consider using cert provisioning tools like Certbot

### Testing DNS Resolution

```bash
# Test DNS resolution from command line
nslookup ass.here
dig ass.here
host ass.here

# Expected output: IP address pointing to your server
# Error: ENOTFOUND, NXDOMAIN, or timeout = DNS not configured correctly
```

---

## Environment Setup

### Required Environment Variables

These must be set in your deployment platform:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ Yes | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | ✅ Yes | Supabase service role key (keep secret!) |
| `SUPABASE_BUCKET` | ❌ No | Storage bucket name (default: `ass-files`) |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Port for local development |
| `ASS_HERE_API_BASE` | `https://ass.here` | Override default API base URL |

### Vercel Secrets

**DO NOT** add secrets as plain environment variables. Use Vercel's encrypted secrets:

1. In Vercel CLI: `vercel secrets add SUPABASE_SERVICE_KEY`
2. Or in Web UI: Project Settings → Environment Variables → mark as "Sensitive"

---

## Health Checks

ass.here includes a health check endpoint to verify API availability:

```bash
curl https://ass.here/api/v1/health
```

### Expected Response

**If healthy (200):**
```json
{
  "status": "healthy",
  "message": "API is operational",
  "timestamp": "2026-06-20T10:30:00.000Z",
  "checks": {
    "database": "ok",
    "supabase": "connected"
  }
}
```

**If unhealthy (503):**
```json
{
  "status": "unhealthy",
  "message": "Database connection failed",
  "error": "Connection refused"
}
```

### Using Health Checks

- **Monitoring**: Set up monitoring tools to periodically call `/api/v1/health`
- **Load balancers**: Use this endpoint for health check routing
- **Client debugging**: Call this when diagnosing why the API is unreachable

---

## Troubleshooting

### Issue: "DNS resolution failed" / "ENOTFOUND"

**Cause:** DNS records not configured or not yet propagated

**Solutions:**
1. Verify DNS records are set (see [DNS Configuration](#dns-configuration))
2. Wait 5-48 hours for DNS propagation
3. Test with: `nslookup ass.here`
4. Try alternative: Use a different domain or test with `vercel.app` domain first

### Issue: "Connection refused" / "ECONNREFUSED"

**Cause:** API is not running or firewall is blocking

**Solutions:**
1. Check if the service is running: `curl https://ass.here/api/v1/health`
2. Check firewall rules allow HTTPS (port 443)
3. Check logs in deployment platform (Vercel, AWS, etc.)
4. Verify environment variables are set correctly

### Issue: "SSL certificate error" / "CERT_EXPIRED"

**Cause:** SSL certificate missing, invalid, or expired

**Solutions:**
1. **Vercel users**: Vercel auto-manages certs; refresh the domain
2. **Other platforms**: Install a valid certificate
   - Let's Encrypt (free): Use Certbot
   - Commercial: Purchase from a CA and install

### Issue: "504 Timeout" / "Service Unavailable"

**Cause:** API endpoint too slow or database query failing

**Solutions:**
1. Check Supabase database status
2. Check if SUPABASE_SERVICE_KEY is correct
3. Review API logs for errors
4. Check database query performance (especially `/api/v1/search`)

### Issue: Clients report "API unreachable" but DNS works

**Cause:** API responding with errors or slow responses

**Solutions:**
1. Test the health endpoint: `curl https://ass.here/api/v1/health`
2. Check HTTPS is working: `curl -I https://ass.here/api/v1/recent`
3. Verify CORS headers (if calling from browser)
4. Check if rate limiting is blocking requests

### Issue: Clients get "Cannot fetch" from browser

**Cause:** CORS (Cross-Origin Resource Sharing) headers not configured

**Solutions:**
1. ass.here should allow CORS by default (Express CORS middleware)
2. Check that responses include `Access-Control-Allow-Origin: *`
3. Verify no reverse proxy is stripping CORS headers

---

## Monitoring & Alerting

### Recommended Setup

1. **Uptime Monitoring**
   - Use services like: UptimeRobot, StatusPage.io, or Vercel Analytics
   - Monitor: `https://ass.here/api/v1/health`
   - Alert on 2+ failures

2. **Error Tracking**
   - Set up Sentry, LogRocket, or similar
   - Monitor `/api/v1/search` and `/api/v1/upload` endpoints

3. **Database Monitoring**
   - Monitor Supabase project for connection errors and slow queries
   - Set alerts on error rates > 5%

4. **Client Feedback**
   - Encourage users to report API issues
   - Log and aggregate error reports

---

## Next Steps

- Read [CLIENT_SETUP.md](CLIENT_SETUP.md) to configure clients to find your API
- Review [README.md](README.md) for API endpoint documentation
- Check Supabase docs for scaling and backup strategies
