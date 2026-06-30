// Atomic IP rate limiter for uploads, backed by a Postgres RPC.
//
// Backed by `consume_upload_quota(ip, limit, window_sec)` (see
// migrations/002_upload_rate_limits.sql). The function increments a per-IP
// counter and reports allowed/over-limit in a single SQL statement, so two
// concurrent uploads from the same IP can't both slip past the limit.
//
// Failure policy: if the DB call itself errors (network blip, transient
// outage, missing migration), we **fail open** with a loud warn — but only
// after we explicitly distinguish "DB is reachable but the call failed" from
// "DB is unreachable so we have no auth data at all". The latter is the
// case where fail-closed (refuse the upload) is the responsible choice,
// because we can't tell whether the caller is over their quota.

const DEFAULTS = Object.freeze({
  limit: 10,         // uploads per IP per window
  windowSec: 3600    // 1 hour
});

export async function checkRateLimit(supabase, ip) {
  if (!supabase) {
    // No DB connection at all. We can't make an honest deny/allow decision.
    // Better to refuse than to advertise an unlimited tier.
    return { ok: false, error: 'rate limiter unavailable (no database connection)' };
  }

  const limit = Math.max(1, Number(process.env.UPLOAD_RATE_LIMIT) || DEFAULTS.limit);
  const windowSec = Math.max(1, Number(process.env.UPLOAD_RATE_WINDOW) || DEFAULTS.windowSec);

  let result;
  try {
    const rpc = await supabase.rpc('consume_upload_quota', {
      p_ip: ip,
      p_limit: limit,
      p_window_sec: windowSec
    });
    if (rpc.error) {
      console.warn('[rateLimit] RPC error (failing closed):', rpc.error.message);
      return { ok: false, error: 'rate limiter unavailable (RPC error)' };
    }
    result = rpc.data;
  } catch (err) {
    // SDK threw before any response arrived — assume DB is down. Fail closed.
    console.warn('[rateLimit] RPC threw (failing closed):', err?.message || err);
    return { ok: false, error: 'rate limiter unavailable (database unreachable)' };
  }

  // Normalize the JSONB shape the SQL function returns. Supabase returns
  // jsonb either as a parsed object (when the response header is set) or as
  // a stringified value; handle both.
  const row = typeof result === 'string' ? safeParse(result) : result;
  if (!row) {
    console.warn('[rateLimit] RPC returned no data (failing closed)');
    return { ok: false, error: 'rate limiter unavailable (empty response)' };
  }

  if (row.reason === 'db_error') {
    // The SQL function itself caught an exception (e.g. table missing or
    // permission revoked). Fail closed: refuse to upload rather than
    // silently allowing unlimited traffic.
    console.warn('[rateLimit] DB error from RPC:', row.error);
    return { ok: false, error: 'rate limiter unavailable (database error)' };
  }

  if (row.allowed === true) {
    return {
      ok: true,
      remaining: Math.max(0, Number(row.limit) - Number(row.count)),
      reset: row.reset_at,
      count: Number(row.count),
      limit: Number(row.limit)
    };
  }

  if (row.allowed === false) {
    return {
      ok: false,
      remaining: 0,
      reset: row.reset_at,
      count: Number(row.count),
      limit: Number(row.limit),
      error: 'rate limit exceeded'
    };
  }

  // Unknown shape — log loudly, fail closed.
  console.warn('[rateLimit] unexpected RPC payload, failing closed:', JSON.stringify(row));
  return { ok: false, error: 'rate limiter unavailable (unexpected response)' };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
