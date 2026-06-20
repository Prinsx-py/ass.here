// Best-effort Supabase-backed IP rate limiter for upload endpoint.
// Does not create DB schema automatically — if the `upload_rate_limits`
// table does not exist this module will silently allow uploads and
// log a warning. Recommended schema (run manually):
// CREATE TABLE upload_rate_limits (ip text PRIMARY KEY, window_start timestamptz, count int);

export async function checkRateLimit(supabase, ip) {
  try {
    if (!supabase) return { ok: true, note: 'no supabase client' };

    const limit = Number(process.env.UPLOAD_RATE_LIMIT || 10);
    const windowSec = Number(process.env.UPLOAD_RATE_WINDOW || 3600);

    const now = new Date();
    const windowStart = new Date(Math.floor(now.getTime() / 1000 / windowSec) * windowSec).toISOString();

    // try to upsert a counter row for this IP (Postgres UPSERT via Supabase)
    const payload = { ip, window_start: windowStart, count: 1 };
    const { data, error } = await supabase.from('upload_rate_limits').select('count,window_start').eq('ip', ip).limit(1);
    if (error) {
      console.warn('RateLimit: could not query upload_rate_limits table (skipping rate limit):', error.message);
      return { ok: true, skipped: true };
    }

    if (!data || data.length === 0) {
      // insert
      const { error: insertErr } = await supabase.from('upload_rate_limits').insert([{ ip, window_start: windowStart, count: 1 }]);
      if (insertErr) {
        console.warn('RateLimit: insert error (skipping):', insertErr.message);
        return { ok: true, skipped: true };
      }
      return { ok: true, remaining: limit - 1, reset: windowStart };
    }

    const row = data[0];
    if (row.window_start !== windowStart) {
      // reset window
      const { error: updErr } = await supabase.from('upload_rate_limits').upsert([{ ip, window_start: windowStart, count: 1 }], { onConflict: 'ip' });
      if (updErr) {
        console.warn('RateLimit: upsert error (skipping):', updErr.message);
        return { ok: true, skipped: true };
      }
      return { ok: true, remaining: limit - 1, reset: windowStart };
    }

    const current = Number(row.count || 0);
    if (current >= limit) {
      return { ok: false, remaining: 0, reset: windowStart };
    }

    const { error: incErr } = await supabase.from('upload_rate_limits').update({ count: current + 1 }).eq('ip', ip);
    if (incErr) {
      console.warn('RateLimit: update error (skipping):', incErr.message);
      return { ok: true, skipped: true };
    }

    return { ok: true, remaining: limit - (current + 1), reset: windowStart };
  } catch (e) {
    console.warn('RateLimit: unexpected error (skipping):', e?.message || e);
    return { ok: true, skipped: true };
  }
}
