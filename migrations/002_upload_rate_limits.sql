-- upload_rate_limits: atomic token-bucket counter per IP.
--
-- Replaces the prior best-effort read-then-write pattern in lib/rateLimit.js,
-- which had a race between the comparison and the increment and would silently
-- allow unlimited uploads when the table was missing or the DB errored.
--
-- The table and the consume_upload_quota() function work together: the JS side
-- only ever calls one RPC, the function does its own locking, and missing rows
-- are inserted on first use.

CREATE TABLE IF NOT EXISTS upload_rate_limits (
  ip            text PRIMARY KEY,
  window_start  timestamptz NOT NULL,
  count         integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_upload_rate_limits_window_start
  ON upload_rate_limits(window_start);

-- consume_upload_quota:
--   Atomically increments the counter for `p_ip` if the current window's count
--   is below `p_limit`. Returns a jsonb row describing the result:
--     { allowed: true,  count: <new>, limit: <limit>, reset_at: <iso> }
--     { allowed: false, count: <existing>, limit: <limit>, reset_at: <iso> }
--     { allowed: false, reason: 'db_error', error: '<msg>' }   -- on failure
--
-- Implementation notes:
--   * One CTE inserts if missing, another computes the window, then UPDATE …
--     WHERE count < limit so the race resolves inside a single statement
--     (Postgres takes a row lock for the duration of the UPDATE).
--   * `clock_timestamp()` (not `now()`) so session-level clock skew doesn't
--     pin a window forever.
--   * `p_window_sec` is clamped to >= 1 to avoid a divide-by-zero.

CREATE OR REPLACE FUNCTION consume_upload_quota(
  p_ip         text,
  p_limit      integer,
  p_window_sec integer
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_window_start timestamptz;
  v_limit        integer := GREATEST(p_limit, 1);
  v_window_sec   integer := GREATEST(p_window_sec, 1);
  v_count        integer;
BEGIN
  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_window_sec) * v_window_sec
  );

  -- Ensure a row exists for this IP. on-conflict do-nothing is fine; the
  -- UPDATE below will still lock and observe the right count.
  INSERT INTO upload_rate_limits (ip, window_start, count)
  VALUES (p_ip, v_window_start, 0)
  ON CONFLICT (ip) DO NOTHING;

  -- Atomic increment, but only when below the limit. RETURNING gives us
  -- either the new count (success) or zero rows (rejected, when already
  -- at/over the limit). We re-read after to handle the rejected branch.
  UPDATE upload_rate_limits
     SET window_start = v_window_start,
         count        = count + 1
   WHERE ip = p_ip
     AND window_start <= v_window_start
     AND count < v_limit
  RETURNING count INTO v_count;

  IF v_count IS NULL THEN
    -- Rejected (over the limit) or window had lapsed without resetting; either
    -- way read the canonical row to report accurate state.
    SELECT count, window_start
      INTO v_count, v_window_start
      FROM upload_rate_limits
     WHERE ip = p_ip;

    IF v_count IS NULL THEN
      -- Lost the row between INSERT and SELECT — extremely rare. Be safe.
      RETURN jsonb_build_object(
        'allowed', false,
        'reason',  'row_missing',
        'limit',   v_limit
      );
    END IF;

    -- If the stored window is stale, treat the row as freshly reset and
    -- allow one more attempt (don't punish across a window boundary mid-call).
    IF v_window_start < (
      to_timestamp(
        floor(extract(epoch from clock_timestamp()) / v_window_sec) * v_window_sec
      )
    ) THEN
      UPDATE upload_rate_limits
         SET window_start = to_timestamp(
               floor(extract(epoch from clock_timestamp()) / v_window_sec) * v_window_sec
             ),
             count        = 1
       WHERE ip = p_ip;
      RETURN jsonb_build_object(
        'allowed',  true,
        'count',    1,
        'limit',    v_limit,
        'reset_at', to_timestamp(
          floor(extract(epoch from clock_timestamp()) / v_window_sec) * v_window_sec
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'allowed',  false,
      'count',    v_count,
      'limit',    v_limit,
      'reset_at', v_window_start
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed',  true,
    'count',    v_count,
    'limit',    v_limit,
    'reset_at', v_window_start
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'allowed', false,
    'reason',  'db_error',
    'error',   SQLERRM
  );
END;
$$;

COMMENT ON FUNCTION consume_upload_quota(text, integer, integer) IS
  'Atomic IP rate-limit check for uploads. Allowed when count < limit, else rejected.';
