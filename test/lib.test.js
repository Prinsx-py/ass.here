// Unit tests for lib/ helpers. Run with `npm test` — uses Node's built-in test runner.
//
// These tests are intentionally hermetic: no network, no DB. They cover the
// pure-JS branches of `validate.js` and the mocked-Supabase branches of
// `rateLimit.js`. End-to-end coverage of the upload/search/get routes
// requires Supabase credentials and isn't automated.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateAssContent, computeSHA256, MAX_ASS_SIZE } from '../lib/validate.js';
import { checkRateLimit } from '../lib/rateLimit.js';

function mockSupabase(rpcResult) {
  return { async rpc() { return rpcResult; } };
}

const VALID_ASS = [
  '[Script Info]',
  'Title: test',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname',
  'Style: Default,Arial',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Text',
  'Dialogue: 0,0:00:00.00,0:00:01.00,Default,hi',
  ''
].join('\n');

describe('validateAssContent', () => {
  it('accepts a minimal valid .ass', () => {
    const r = validateAssContent(VALID_ASS);
    assert.equal(r.valid, true);
    assert.deepEqual(r.errors, []);
  });

  it('rejects when Script Info is missing', () => {
    const r = validateAssContent('[V4+ Styles]\nStyle: x\n[Events]\nx');
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => /Script Info/i.test(e)));
  });

  it('rejects when Events is missing', () => {
    const r = validateAssContent('[Script Info]\n[V4+ Styles]\nx');
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => /Events/i.test(e)));
  });

  it('rejects when styles section is missing (legacy V4 or V4+ required)', () => {
    const r = validateAssContent('[Script Info]\n[Events]\nx');
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => /V4/i.test(e)));
  });

  it('accepts legacy [V4 Styles] (no plus)', () => {
    const legacy = VALID_ASS.replace('[V4+ Styles]', '[V4 Styles]');
    assert.equal(validateAssContent(legacy).valid, true);
  });

  it('treats falsy input as invalid', () => {
    assert.equal(validateAssContent('').valid, false);
    assert.equal(validateAssContent(null).valid, false);
    assert.equal(validateAssContent(undefined).valid, false);
  });
});

describe('computeSHA256', () => {
  it('produces a stable 64-char hex digest', () => {
    const h = computeSHA256('hello');
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(h, computeSHA256('hello'));
  });

  it('changes when input changes', () => {
    assert.notEqual(computeSHA256('a'), computeSHA256('b'));
  });

  it('handles empty / null input without throwing', () => {
    assert.doesNotThrow(() => computeSHA256(''));
    assert.doesNotThrow(() => computeSHA256(null));
  });
});

describe('MAX_ASS_SIZE', () => {
  it('is 200 KB by default', () => {
    assert.equal(MAX_ASS_SIZE, 200 * 1024);
  });
});

describe('checkRateLimit (atomic, fail-closed)', () => {
  it('returns allowed + remaining when below limit', async () => {
    const sb = mockSupabase({ data: { allowed: true, count: 3, limit: 10, reset_at: '2030-01-01T00:00:00Z' }, error: null });
    const r = await checkRateLimit(sb, '1.2.3.4');
    assert.equal(r.ok, true);
    assert.equal(r.count, 3);
    assert.equal(r.limit, 10);
    assert.equal(r.remaining, 7);
  });

  it('returns denied when over the limit', async () => {
    const sb = mockSupabase({ data: { allowed: false, count: 10, limit: 10, reset_at: '2030-01-01T01:00:00Z' }, error: null });
    const r = await checkRateLimit(sb, '1.2.3.4');
    assert.equal(r.ok, false);
    assert.equal(r.remaining, 0);
    assert.equal(r.error, 'rate limit exceeded');
  });

  it('FAILS CLOSED when the SQL function reports db_error (no more silent-open)', async () => {
    const sb = mockSupabase({ data: { reason: 'db_error', error: 'no such table' }, error: null });
    const r = await checkRateLimit(sb, '1.2.3.4');
    assert.equal(r.ok, false);
    assert.match(r.error, /database error/);
  });

  it('FAILS CLOSED when the RPC envelope carries an error', async () => {
    const sb = mockSupabase({ data: null, error: { message: 'permission denied' } });
    const r = await checkRateLimit(sb, '1.2.3.4');
    assert.equal(r.ok, false);
    assert.match(r.error, /RPC error/);
  });

  it('FAILS CLOSED when the RPC throws (network down)', async () => {
    const sb = { async rpc() { throw new Error('ECONNRESET'); } };
    const r = await checkRateLimit(sb, '1.2.3.4');
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
  });

  it('FAILS CLOSED on unexpected RPC payload', async () => {
    const sb = mockSupabase({ data: { unknown: 'shape' }, error: null });
    const r = await checkRateLimit(sb, '1.2.3.4');
    assert.equal(r.ok, false);
    assert.match(r.error, /unexpected/);
  });

  it('FAILS CLOSED when no Supabase client is available', async () => {
    const r = await checkRateLimit(null, '1.2.3.4');
    assert.equal(r.ok, false);
    assert.match(r.error, /no database connection/);
  });

  it('tolerates stringified jsonb in RPC response', async () => {
    const sb = mockSupabase({ data: JSON.stringify({ allowed: true, count: 2, limit: 10, reset_at: '2030-01-01T00:00:00Z' }), error: null });
    const r = await checkRateLimit(sb, '1.2.3.4');
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
  });

  it('honors UPLOAD_RATE_LIMIT override env', async () => {
    const prev = process.env.UPLOAD_RATE_LIMIT;
    process.env.UPLOAD_RATE_LIMIT = '3';
    let observedLimit = null;
    const sb = {
      async rpc(name, args) {
        observedLimit = args.p_limit;
        return { data: { allowed: true, count: 1, limit: args.p_limit, reset_at: '2030-01-01' }, error: null };
      }
    };
    await checkRateLimit(sb, '1.2.3.4');
    assert.equal(observedLimit, 3);
    if (prev === undefined) delete process.env.UPLOAD_RATE_LIMIT;
    else process.env.UPLOAD_RATE_LIMIT = prev;
  });
});
